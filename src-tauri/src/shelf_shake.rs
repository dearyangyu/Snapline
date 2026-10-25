//! Pure recognizer fed only by real Windows OLE callbacks. Distances are
//! physical pixels normalized by the source monitor scale; no input is injected.
#[derive(Default)]
struct Axis {
    extreme: Option<f64>,
    direction: i8,
    reversals: u8,
    first_turn: u64,
    last_turn: u64,
}
impl Axis {
    fn sample(&mut self, position: f64, elapsed_ms: u64, amplitude: f64) -> bool {
        let Some(extreme) = self.extreme else {
            self.extreme = Some(position);
            return false;
        };
        let delta = position - extreme;
        if self.direction == 0 {
            if delta.abs() >= amplitude {
                self.direction = if delta > 0.0 { 1 } else { -1 };
                self.extreme = Some(position);
                self.last_turn = elapsed_ms;
            }
            return false;
        }
        if delta * f64::from(self.direction) > 0.0 {
            self.extreme = Some(position);
            return false;
        }
        // A reversal must travel a complete 48-DIP leg, rather than counting
        // tiny sign changes around a turning point as separate shakes.
        if delta.abs() < amplitude {
            return false;
        }
        if elapsed_ms.saturating_sub(self.last_turn) > 400
            || elapsed_ms.saturating_sub(self.first_turn) > 1100
        {
            self.reversals = 0;
        }
        if self.reversals == 0 {
            self.first_turn = elapsed_ms;
        }
        self.reversals += 1;
        self.last_turn = elapsed_ms;
        self.direction = -self.direction;
        self.extreme = Some(position);
        self.reversals >= 3
    }
}

pub struct ShakeDetector {
    horizontal: Axis,
    vertical: Axis,
    amplitude: f64,
    triggered: bool,
}
impl ShakeDetector {
    pub fn new(scale: f64) -> Self {
        Self {
            horizontal: Axis::default(),
            vertical: Axis::default(),
            amplitude: 48.0
                * if scale.is_finite() {
                    scale.clamp(0.5, 8.0)
                } else {
                    1.0
                },
            triggered: false,
        }
    }
    pub fn sample(&mut self, point: (i32, i32), elapsed_ms: u64) -> bool {
        self.triggered |= self
            .horizontal
            .sample(f64::from(point.0), elapsed_ms, self.amplitude)
            | self
                .vertical
                .sample(f64::from(point.1), elapsed_ms, self.amplitude);
        self.triggered
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_export_and_small_cursor_jitter_do_not_dismiss() {
        let mut detector = ShakeDetector::new(1.0);
        for i in 0..100 {
            assert!(!detector.sample((-2400 + i * 9, 100 + (i % 5) * 2), (i * 16) as u64));
        }
        let mut detector = ShakeDetector::new(1.0);
        for i in 0..100 {
            assert!(!detector.sample((300 + (i % 2) * 20, 100), (i * 16) as u64));
        }
    }
    #[test]
    fn three_full_quick_reversals_are_required_at_every_source_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let mut detector = ShakeDetector::new(scale);
            let distance = (60.0 * scale) as i32;
            for (i, x) in [0, distance, 0, distance].into_iter().enumerate() {
                assert!(!detector.sample((x, 100), i as u64 * 100));
            }
            assert!(detector.sample((0, 100), 400));
        }
    }
    #[test]
    fn slow_navigation_or_spaced_reversals_do_not_accumulate() {
        let mut detector = ShakeDetector::new(1.0);
        for i in 0..20 {
            assert!(!detector.sample(((i % 2) * 100, 0), i as u64 * 600));
        }
    }
}
