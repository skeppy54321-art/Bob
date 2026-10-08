import math
import unittest

import flight_computer as fc

# Values from the original run: weight 119.42 N, thrust 525 N, 40 deg, 25 m/s.
MASS = 119.42 / fc.G


class FlightComputerTests(unittest.TestCase):
    def test_net_force_is_thrust_minus_weight(self):
        self.assertAlmostEqual(fc.net_force(525.0, MASS), 405.58, places=2)

    def test_acceleration(self):
        self.assertAlmostEqual(fc.acceleration(525.0, MASS), 33.32, places=2)

    def test_acceleration_in_g(self):
        self.assertAlmostEqual(fc.acceleration(525.0, MASS) / fc.G, 3.40, places=2)

    def test_velocity_components(self):
        v_x, v_y = fc.velocity_components(25.0, 40.0)
        self.assertAlmostEqual(v_x, 19.151, places=3)
        self.assertAlmostEqual(v_y, 16.070, places=3)
        self.assertAlmostEqual(math.hypot(v_x, v_y), 25.0)

    def test_no_go_when_thrust_below_weight(self):
        twr = fc.thrust_to_weight(100.0, MASS)
        self.assertEqual(fc.system_status(twr)[0], "NO-GO")

    def test_go_when_thrust_exceeds_weight(self):
        twr = fc.thrust_to_weight(525.0, MASS)
        self.assertEqual(fc.system_status(twr)[0], "GO")


if __name__ == "__main__":
    unittest.main()
