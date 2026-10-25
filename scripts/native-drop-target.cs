// Manual native OLE integration fixture. No UI automation or product IPC.
using System;
using System.IO;
using System.Drawing;
using System.Security.Cryptography;
using System.Windows.Forms;

// Diagnostics observe ordinary mouse/OLE events only; they never inject input.
class DragDiagnostics {
    readonly string path;
    long sequence;
    public DragDiagnostics(string directory) { path = Path.Combine(directory, "drag-events.tsv"); }
    public void Write(string name, string details) {
        try {
            File.AppendAllText(path, DateTime.UtcNow.ToString("O") + "\t" + (++sequence) + "\t" + name + "\t" +
                (details ?? "").Replace("\t", " ").Replace("\r", " ").Replace("\n", " ") + Environment.NewLine);
        } catch (Exception error) { System.Diagnostics.Debug.WriteLine("Drag diagnostic log failed: " + error.Message); }
    }
}

// Delay dragging until the Windows drag threshold is crossed. A press on an
// already selected row keeps the whole selection until it becomes a click.
class FileDragListBox : ListBox {
    public DragDiagnostics Diagnostics;
    Point dragOrigin;
    bool dragPending;
    bool deferredSelection;
    int pressedIndex = -1;

    void Log(string name, string details) { if (Diagnostics != null) Diagnostics.Write("Source." + name, details); }
    string Position(Point point) {
        var screen = PointToScreen(point);
        return "client=" + point.X + "," + point.Y + ";screen=" + screen.X + "," + screen.Y;
    }

    protected override void WndProc(ref Message message) {
        const int WM_LBUTTONDOWN = 0x0201;
        if (message.Msg == WM_LBUTTONDOWN && ModifierKeys == Keys.None) {
            long packed = message.LParam.ToInt64();
            var point = new Point(unchecked((short)(packed & 0xffff)), unchecked((short)((packed >> 16) & 0xffff)));
            int index = IndexFromPoint(point);
            if (index >= 0 && SelectedIndices.Count > 1 && GetSelected(index)) {
                Focus();
                dragOrigin = point;
                pressedIndex = index;
                dragPending = true;
                deferredSelection = true;
                Capture = true;
                Log("MouseDown", Position(point) + ";row=" + index + ";selected=" + SelectedItems.Count + ";deferredSelection=true");
                return;
            }
        }
        base.WndProc(ref message);
    }

    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        dragOrigin = e.Location;
        pressedIndex = IndexFromPoint(e.Location);
        dragPending = pressedIndex >= 0;
        deferredSelection = false;
        Log("MouseDown", Position(e.Location) + ";row=" + pressedIndex + ";selected=" + SelectedItems.Count + ";deferredSelection=false");
    }

    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e);
        if (!dragPending || (e.Button & MouseButtons.Left) == 0) return;
        var threshold = new Rectangle(
            dragOrigin.X - SystemInformation.DragSize.Width / 2,
            dragOrigin.Y - SystemInformation.DragSize.Height / 2,
            SystemInformation.DragSize.Width, SystemInformation.DragSize.Height);
        if (threshold.Contains(e.Location)) return;
        Log("ThresholdCrossed", Position(e.Location) + ";origin=" + dragOrigin.X + "," + dragOrigin.Y +
            ";threshold=" + threshold.Width + "x" + threshold.Height + ";selected=" + SelectedItems.Count);
        dragPending = false;
        deferredSelection = false;
        Capture = false;
        if (SelectedItems.Count == 0) { Log("DragSkipped", "No selected paths"); return; }
        var paths = new string[SelectedItems.Count];
        for (int i = 0; i < paths.Length; i++) paths[i] = (string)SelectedItems[i];
        Log("DoDragDropBegin", "count=" + paths.Length + ";allowed=Copy;paths=" + string.Join(" | ", paths));
        try {
            var effect = DoDragDrop(new DataObject(DataFormats.FileDrop, paths), DragDropEffects.Copy);
            Log("DoDragDropReturn", "effect=" + effect + ";count=" + paths.Length);
        } catch (Exception error) {
            Log("DoDragDropError", error.ToString());
            throw;
        }
    }

    protected override void OnMouseUp(MouseEventArgs e) {
        if (e.Button == MouseButtons.Left) {
            Log("MouseUp", Position(e.Location) + ";dragPending=" + dragPending + ";selected=" + SelectedItems.Count);
            if (deferredSelection && dragPending && pressedIndex >= 0) {
                ClearSelected();
                SetSelected(pressedIndex, true);
            }
            dragPending = false;
            deferredSelection = false;
            Capture = false;
        }
        base.OnMouseUp(e);
    }

    protected override void OnQueryContinueDrag(QueryContinueDragEventArgs e) {
        base.OnQueryContinueDrag(e);
        if (e.EscapePressed || e.Action != DragAction.Continue)
            Log("QueryContinueDrag", "escape=" + e.EscapePressed + ";keys=" + e.KeyState + ";action=" + e.Action);
    }

    protected override void OnKeyDown(KeyEventArgs e) {
        if (e.Control && e.KeyCode == Keys.A) {
            BeginUpdate();
            try { for (int i = 0; i < Items.Count; i++) SetSelected(i, true); }
            finally { EndUpdate(); }
            e.Handled = true;
            e.SuppressKeyPress = true;
            return;
        }
        base.OnKeyDown(e);
    }
}

class NativeDropTarget : Form {
    readonly string root;
    readonly DragDiagnostics diagnostics;
    readonly System.Diagnostics.Stopwatch dragClock = System.Diagnostics.Stopwatch.StartNew();
    long lastDragOver = -250;
    readonly Label result = new Label();
    readonly FileDragListBox files = new FileDragListBox();
    NativeDropTarget(string output, string fixtures) {
        root = output; Directory.CreateDirectory(root);
        diagnostics = new DragDiagnostics(root);
        files.Diagnostics = diagnostics;
        diagnostics.Write("Fixture.Start", "pid=" + System.Diagnostics.Process.GetCurrentProcess().Id +
            ";output=" + Path.GetFullPath(output) + ";fixtures=" + Path.GetFullPath(fixtures));
        Text = "Snapline QA - Windows File Drop Target";
        StartPosition = FormStartPosition.Manual;
        Location = new Point(1600, 300); Size = new Size(700, 750);
        AllowDrop = true; TopMost = true; MaximizeBox = true;
        BackColor = Color.FromArgb(235,241,237);
        var heading = new Label { Text = "Drop an image here\nNative Windows FileDrop / Copy", Dock = DockStyle.Top, Height = 100, Font = new Font("Segoe UI", 18), TextAlign = ContentAlignment.MiddleCenter };
        result.Text = "Waiting for an external file drop"; result.Dock=DockStyle.Fill;
        result.TextAlign=ContentAlignment.MiddleCenter; result.Font=new Font("Segoe UI",12);
        var topMostToggle = new CheckBox {
            Text = "Keep QA window on top (disable before maximizing as a drag source)",
            Checked = true, Dock = DockStyle.Top, Height = 42,
            Font = new Font("Segoe UI", 11), Padding = new Padding(14, 0, 0, 0)
        };
        topMostToggle.CheckedChanged += (s,e) => {
            TopMost = topMostToggle.Checked;
            diagnostics.Write("Fixture.TopMost", "enabled=" + TopMost);
        };
        files.Dock=DockStyle.Bottom; files.Height=150;
        files.SelectionMode = SelectionMode.MultiExtended;
        var sourceFiles = Directory.GetFiles(fixtures,"*.png");
        Array.Sort(sourceFiles, StringComparer.OrdinalIgnoreCase);
        foreach(var file in sourceFiles) files.Items.Add(file);
        Controls.Add(result); Controls.Add(files); Controls.Add(topMostToggle); Controls.Add(heading);
        DragEnter += (s,e) => {
            e.Effect=e.Data.GetDataPresent(DataFormats.FileDrop)?DragDropEffects.Copy:DragDropEffects.None;
            lastDragOver = -250;
            diagnostics.Write("Target.DragEnter", DropDetails(e));
        };
        DragOver += (s,e) => {
            long elapsed = dragClock.ElapsedMilliseconds;
            if (elapsed - lastDragOver < 250) return;
            lastDragOver = elapsed;
            diagnostics.Write("Target.DragOver", DropDetails(e));
        };
        DragLeave += (s,e) => diagnostics.Write("Target.DragLeave", "");
        DragDrop += (s,e) => {
            diagnostics.Write("Target.Drop", DropDetails(e));
            try {
                var paths=(string[])e.Data.GetData(DataFormats.FileDrop);
                foreach(var path in paths) {
                    var destination=Path.Combine(root,Path.GetFileName(path));
                    if(File.Exists(destination)) destination=Path.Combine(root,Guid.NewGuid().ToString()+".png");
                    File.Copy(path,destination,false);
                    string hash; using(var sha=SHA256.Create()) using(var input=File.OpenRead(destination)) hash=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","");
                    File.AppendAllText(Path.Combine(root,"drop-log.txt"),path+"\t"+destination+"\t"+hash+Environment.NewLine);
                    diagnostics.Write("Target.FileCopied", "source=" + path + ";destination=" + destination +
                        ";sha256=" + hash + ";sourceExists=" + File.Exists(path));
                    result.Text="RECEIVED: "+Path.GetFileName(path)+"\n"+new FileInfo(destination).Length+" bytes\nSHA256 "+hash+"\nSource still exists: "+File.Exists(path);
                }
                diagnostics.Write("Target.DropComplete", "count=" + paths.Length);
            } catch(Exception error) {
                diagnostics.Write("Target.DropError", error.ToString());
                result.Text=error.ToString(); File.AppendAllText(Path.Combine(root,"errors.txt"),error.ToString());
            }
        };
        FormClosed += (s,e) => diagnostics.Write("Fixture.Closed", "");
    }
    static string DropDetails(DragEventArgs e) {
        return "screen=" + e.X + "," + e.Y + ";keys=" + e.KeyState + ";allowed=" + e.AllowedEffect + ";effect=" + e.Effect;
    }
    [STAThread] static void Main(string[] args) {
        var directory=AppDomain.CurrentDomain.BaseDirectory;
        Application.EnableVisualStyles(); Application.Run(new NativeDropTarget(
            args.Length>0?args[0]:Path.Combine(directory,"drop-received"),
            args.Length>1?args[1]:Path.Combine(directory,"scroll-fixtures")));
    }
}
