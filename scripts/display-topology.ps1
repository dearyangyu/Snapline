param([string]$OutputPath = (Join-Path $PSScriptRoot '../artifacts/native-qa/display-topology-v031.json'))
# Read-only monitor inventory. A temporary thread context affects this query only.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SnaplineDisplayInventory {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Info { public int Size; public Rect Monitor,Work; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string Device; }
 public class Display { public string Device; public bool Primary; public int X,Y,Width,Height,WorkX,WorkY,WorkWidth,WorkHeight,ScalePercent,ScaleResult; }
 delegate bool EnumCallback(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,EnumCallback callback,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor,ref Info info);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("shcore.dll")] static extern int GetScaleFactorForMonitor(IntPtr monitor,out int scale);
 public static Display[] Read(){var rows=new List<Display>();var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));try{
  EnumCallback callback=delegate(IntPtr monitor,IntPtr dc,ref Rect bounds,IntPtr data){var info=new Info{Size=Marshal.SizeOf(typeof(Info))};if(!GetMonitorInfo(monitor,ref info))throw new System.ComponentModel.Win32Exception();int scale;int result=GetScaleFactorForMonitor(monitor,out scale);rows.Add(new Display{Device=info.Device,Primary=(info.Flags&1)!=0,X=info.Monitor.Left,Y=info.Monitor.Top,Width=info.Monitor.Right-info.Monitor.Left,Height=info.Monitor.Bottom-info.Monitor.Top,WorkX=info.Work.Left,WorkY=info.Work.Top,WorkWidth=info.Work.Right-info.Work.Left,WorkHeight=info.Work.Bottom-info.Work.Top,ScalePercent=scale,ScaleResult=result});return true;};
  if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,callback,IntPtr.Zero))throw new System.ComponentModel.Win32Exception();return rows.ToArray();
 }finally{if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}}
}
"@
$record=[ordered]@{Timestamp=(Get-Date -Format o);Method='Read-only EnumDisplayMonitors + GetMonitorInfo + GetScaleFactorForMonitor; temporary per-monitor-v2 thread query context restored';Displays=@([SnaplineDisplayInventory]::Read());Limits='Inventory only; no window interaction, no display settings changes, no mixed-DPI behavior test'}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$record | ConvertTo-Json -Depth 5
