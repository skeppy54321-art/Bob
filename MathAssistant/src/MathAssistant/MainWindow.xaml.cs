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

    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            await vm.DisposeAsync();
    }
}
