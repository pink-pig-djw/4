// FAU Campus 3D – Windows launcher.
// The whole game (one offline HTML file) is embedded in this exe. On start it is written to
// %LOCALAPPDATA%\FAU-Campus-3D\ and opened in a Microsoft Edge app window (Edge is part of
// Windows 10/11). If Edge is missing, the default browser is used instead.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        try
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FAU-Campus-3D");
            Directory.CreateDirectory(dir);
            string html = Path.Combine(dir, "FAU-Campus.html");
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream("FAU-Campus.html"))
            {
                if (s == null) throw new Exception("embedded game file missing");
                byte[] data = new byte[s.Length];
                int read = 0;
                while (read < data.Length) { int n = s.Read(data, read, data.Length - read); if (n <= 0) break; read += n; }
                bool same = File.Exists(html) && new FileInfo(html).Length == data.Length && Same(File.ReadAllBytes(html), data);
                if (!same)
                {
                    string tmp = html + ".tmp";
                    File.WriteAllBytes(tmp, data);
                    if (File.Exists(html)) File.Delete(html);
                    File.Move(tmp, html);
                }
            }
            string url = new Uri(html).AbsoluteUri;
            string edge = FindEdge();
            if (edge != null)
            {
                ProcessStartInfo psi = new ProcessStartInfo(edge, "--app=\"" + url + "\" --start-maximized --no-first-run");
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else
            {
                Process.Start(html);
            }
        }
        catch (Exception e)
        {
            MessageBox.Show("FAU Campus 3D konnte nicht gestartet werden.\n启动失败。\n\n" + e.Message, "FAU Campus 3D", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static bool Same(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    static string FindEdge()
    {
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
        };
        foreach (string p in candidates) if (File.Exists(p)) return p;
        return null;
    }
}
