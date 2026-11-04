using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace MathAssistant.Views;

/// <summary>Maps a chat role to a bubble background brush.</summary>
public sealed class RoleToBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        var key = (value as string) == "user" ? "UserBubble" : "AssistantBubble";
        return Application.Current.Resources[key] ?? new SolidColorBrush(Colors.Gray);
    }
    public object ConvertBack(object value, Type t, object p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Maps a chat role to left/right alignment.</summary>
public sealed class RoleToAlignmentConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        => (value as string) == "user" ? HorizontalAlignment.Right : HorizontalAlignment.Left;
    public object ConvertBack(object value, Type t, object p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Null/empty string -> Collapsed, otherwise Visible.</summary>
public sealed class StringToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        => string.IsNullOrWhiteSpace(value as string) ? Visibility.Collapsed : Visibility.Visible;
    public object ConvertBack(object value, Type t, object p, CultureInfo c) => Binding.DoNothing;
}
