using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;

namespace MathAssistant.Services;

/// <summary>
/// Turns a picked file, a pasted clipboard image, or a PDF page into PNG bytes,
/// downscaled so we don't ship huge images to the AI. Uses WPF's own imaging
/// stack (Windows-native); PDF rasterization shells out to Poppler's pdftoppm
/// if it is available on PATH.
/// </summary>
public sealed class ImageImportService
{
    private readonly int _maxEdge;

    public ImageImportService(int maxEdgePixels) => _maxEdge = Math.Max(256, maxEdgePixels);

    public (byte[] png, string mediaType) FromFile(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext == ".pdf")
            return FromPdf(path, page: 1);

        using var fs = File.OpenRead(path);
        var src = DecodeAndScale(fs);
        return (EncodePng(src), "image/png");
    }

    public byte[]? FromClipboard()
    {
        if (!Clipboard.ContainsImage()) return null;
        var bmp = Clipboard.GetImage();
        if (bmp is null) return null;
        var scaled = Scale(bmp);
        return EncodePng(scaled);
    }

    /// <summary>Rasterize one PDF page to PNG via Poppler's pdftoppm.</summary>
    public (byte[] png, string mediaType) FromPdf(string path, int page)
    {
        var tempPrefix = Path.Combine(Path.GetTempPath(), "mathassist_" + Guid.NewGuid().ToString("N"));
        var psi = new ProcessStartInfo
        {
            FileName = "pdftoppm",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-png");
        psi.ArgumentList.Add("-r"); psi.ArgumentList.Add("150");
        psi.ArgumentList.Add("-f"); psi.ArgumentList.Add(page.ToString());
        psi.ArgumentList.Add("-l"); psi.ArgumentList.Add(page.ToString());
        psi.ArgumentList.Add(path);
        psi.ArgumentList.Add(tempPrefix);

        try
        {
            using var proc = Process.Start(psi)
                ?? throw new InvalidOperationException("Could not start pdftoppm.");
            proc.WaitForExit(30_000);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                "PDF import needs Poppler (pdftoppm) on PATH. Install it or export the page as an image first. " + ex.Message);
        }

        var produced = Directory.GetFiles(Path.GetDirectoryName(tempPrefix)!,
            Path.GetFileName(tempPrefix) + "*.png").FirstOrDefault()
            ?? throw new InvalidOperationException("pdftoppm produced no output for that page.");
        try
        {
            using var fs = File.OpenRead(produced);
            var src = DecodeAndScale(fs);
            return (EncodePng(src), "image/png");
        }
        finally { try { File.Delete(produced); } catch { } }
    }

    private BitmapSource DecodeAndScale(Stream s)
    {
        var decoder = BitmapDecoder.Create(s, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        return Scale(decoder.Frames[0]);
    }

    private BitmapSource Scale(BitmapSource src)
    {
        int w = src.PixelWidth, h = src.PixelHeight;
        double scale = Math.Min(1.0, (double)_maxEdge / Math.Max(w, h));
        if (scale >= 1.0) return src;
        var tb = new TransformedBitmap(src, new System.Windows.Media.ScaleTransform(scale, scale));
        tb.Freeze();
        return tb;
    }

    private static byte[] EncodePng(BitmapSource src)
    {
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(src));
        using var ms = new MemoryStream();
        enc.Save(ms);
        return ms.ToArray();
    }
}
