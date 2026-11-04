using System.Windows;
using System.Windows.Threading;

namespace MathAssistant;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        // Don't let an unexpected exception kill the whole app silently.
        DispatcherUnhandledException += OnUnhandled;
    }

    private void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show(e.Exception.Message, "MathAssistant - unexpected error",
            MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }
}
