"""Rocket Engineering III - Python Flight Computer.

Computes liftoff forces, acceleration, and launch-velocity components for a
model rocket, and gives a GO / NO-GO call based on thrust-to-weight ratio.
"""

import math

G = 9.81  # standard gravity, m/s^2
MIN_TWR = 1.0  # below this the rocket cannot lift off at all
SAFE_TWR = 5.0  # common rule of thumb for a safe, stable rail exit


def weight(mass_kg):
    """Weight (N) of a rocket of the given mass."""
    return mass_kg * G


def net_force(thrust_n, mass_kg):
    """Net vertical force (N) at liftoff: thrust minus weight."""
    return thrust_n - weight(mass_kg)


def acceleration(thrust_n, mass_kg):
    """Initial acceleration (m/s^2) from Newton's second law, a = F_net / m."""
    return net_force(thrust_n, mass_kg) / mass_kg


def thrust_to_weight(thrust_n, mass_kg):
    return thrust_n / weight(mass_kg)


def velocity_components(speed, angle_deg):
    """Split a launch speed into horizontal and vertical components."""
    angle_rad = math.radians(angle_deg)
    return speed * math.cos(angle_rad), speed * math.sin(angle_rad)


def system_status(twr):
    """Return (status, note) for a given thrust-to-weight ratio."""
    if twr <= MIN_TWR:
        return "NO-GO", "Thrust does not exceed weight - rocket will not lift off."
    if twr < SAFE_TWR:
        return "GO", f"Warning: T/W below {SAFE_TWR:.0f} - rail exit may be unstable."
    return "GO", "T/W is healthy."


def ask_float(prompt, minimum=None, maximum=None):
    """Prompt until the user enters a number inside [minimum, maximum]."""
    while True:
        try:
            value = float(input(prompt))
        except ValueError:
            print("  Please enter a number.")
            continue
        if not math.isfinite(value):
            print("  Please enter a finite number.")
        elif minimum is not None and value <= minimum:
            print(f"  Value must be greater than {minimum}.")
        elif maximum is not None and value > maximum:
            print(f"  Value must be at most {maximum}.")
        else:
            return value


def ask_name(prompt):
    while True:
        name = input(prompt).strip()
        if name:
            return name
        print("  Name cannot be empty.")


def main():
    print("Rocket Engineering III")
    print("Python Flight Computer Online")

    name = ask_name("Enter rocket name: ")
    mass = ask_float("Rocket mass (kg): ", minimum=0)
    thrust = ask_float("Motor thrust (N): ", minimum=0)
    angle = ask_float("Launch angle (degrees, 0-90): ", minimum=0, maximum=90)
    speed = ask_float("Initial launch speed (m/s): ", minimum=0)

    w = weight(mass)
    f_net = net_force(thrust, mass)
    a = acceleration(thrust, mass)
    twr = thrust_to_weight(thrust, mass)
    v_x, v_y = velocity_components(speed, angle)
    status, note = system_status(twr)

    print()
    print(f"System Status: {status} - {note}")
    print(f"Flight computer configured for {name}.")
    print()
    print(f"Rocket Mass:            {mass:8.2f} kg")
    print(f"Rocket Weight:          {w:8.2f} N")
    print(f"Motor Thrust:           {thrust:8.2f} N")
    print(f"Net Force:              {f_net:8.2f} N")
    print(f"Thrust-to-Weight:       {twr:8.2f}")
    print(f"Acceleration:           {a:8.2f} m/s^2")
    print(f"Initial Acceleration:   {a / G:8.2f} g")
    print()
    print(f"Launch Angle:           {angle:8.1f} degrees ({math.radians(angle):.4f} rad)")
    print(f"Launch Speed:           {speed:8.2f} m/s")
    print(f"v_ix:                   {v_x:8.3f} m/s")
    print(f"v_iy:                   {v_y:8.3f} m/s")


if __name__ == "__main__":
    main()
