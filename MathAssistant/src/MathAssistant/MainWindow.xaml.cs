using System.ComponentModel;
using System.Windows;
using MathAssistant.ViewModels;

namespace MathAssistant;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Closing += OnClosing;
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        // Block briefly so the Python engine is shut down before the process
        // exits. An `async void` handler would return immediately and let the
        // window close before disposal ran, orphaning the child python process.
        if (DataContext is MainViewModel vm)
        {
            try { vm.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(3)); }
            catch { /* best effort during shutdown */ }
        }
    }
}
