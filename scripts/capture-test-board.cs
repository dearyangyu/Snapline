// Deterministic visual fixture for manual screenshot/annotation verification.
// No automation, product IPC, networking or access to user data.
using System;
using System.Drawing;
using System.Windows.Forms;
class CaptureTestBoard : Form {
    CaptureTestBoard() {
        Text = "Snapline QA - Capture Test Board";
        StartPosition = FormStartPosition.Manual;
        Location = new Point(250,180); ClientSize = new Size(1400,820);
        DoubleBuffered = true; BackColor = Color.FromArgb(246,248,251);
    }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); var g=e.Graphics;
        using(var grid=new Pen(Color.FromArgb(218,226,236))) {
            for(int x=0;x<ClientSize.Width;x+=20) g.DrawLine(grid,x,0,x,ClientSize.Height);
            for(int y=0;y<ClientSize.Height;y+=20) g.DrawLine(grid,0,y,ClientSize.Width,y);
        }
        using(var title=new Font("Microsoft YaHei",30,FontStyle.Bold))
        using(var body=new Font("Microsoft YaHei",18))
        using(var mono=new Font("Consolas",16)) {
            g.DrawString("截图 · 标注 · 输出",title,Brushes.MidnightBlue,60,40);
            g.DrawString("Snapline native visual QA / 20 px grid",mono,Brushes.SlateGray,64,106);
            var colors=new[]{Color.FromArgb(232,75,69),Color.FromArgb(40,114,225),Color.FromArgb(35,160,100),Color.FromArgb(242,174,43)};
            for(int i=0;i<4;i++) {
                using(var fill=new SolidBrush(colors[i])) g.FillRectangle(fill,60+i*315,180,280,160);
                g.DrawString("0"+(i+1),title,Brushes.White,82+i*315,200);
                g.DrawString("COLOR / "+(i+1),mono,Brushes.White,82+i*315,282);
            }
            g.FillRectangle(Brushes.White,60,390,1280,300);
            g.DrawString("中文输入验证  ABC 123",body,Brushes.Black,90,420);
            g.DrawString("箭头指向 · 框选区域 · 马赛克 · 模糊 · 橡皮擦恢复原画面",body,Brushes.Black,90,480);
            for(int y=540;y<650;y+=8) for(int x=90;x<800;x+=8)
                g.FillRectangle(((x+y)/8)%2==0?Brushes.Black:Brushes.White,x,y,8,8);
            g.DrawString("CONTROLLED TEST CONTENT",mono,Brushes.DarkSlateBlue,850,570);
        }
    }
    [STAThread] static void Main() { Application.EnableVisualStyles(); Application.Run(new CaptureTestBoard()); }
}
