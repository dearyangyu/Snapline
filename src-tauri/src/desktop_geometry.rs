//! Physical desktop geometry; DPI factors belong at CSS/logical boundaries only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
impl DesktopRect {
    pub fn contains(self, point: (i32, i32)) -> bool {
        let x = i64::from(point.0);
        let y = i64::from(point.1);
        x >= i64::from(self.x)
            && y >= i64::from(self.y)
            && x < i64::from(self.x) + i64::from(self.width)
            && y < i64::from(self.y) + i64::from(self.height)
    }
    pub fn clipped_to(self, frame: Self) -> Option<(u32, u32, u32, u32)> {
        let left = i64::from(self.x).max(i64::from(frame.x));
        let top = i64::from(self.y).max(i64::from(frame.y));
        let right = (i64::from(self.x) + i64::from(self.width))
            .min(i64::from(frame.x) + i64::from(frame.width));
        let bottom = (i64::from(self.y) + i64::from(self.height))
            .min(i64::from(frame.y) + i64::from(frame.height));
        (right > left && bottom > top).then_some((
            (left - i64::from(frame.x)) as u32,
            (top - i64::from(frame.y)) as u32,
            (right - left) as u32,
            (bottom - top) as u32,
        ))
    }
    pub fn crop_inside(self, frame: Self) -> Option<(u32, u32, u32, u32)> {
        self.clipped_to(frame)
            .filter(|(_, _, width, height)| *width == self.width && *height == self.height)
    }
    pub fn center_window(self, width: u32, height: u32) -> (i32, i32) {
        let centered = |origin: i32, available: u32, size: u32| {
            (i64::from(origin) + (i64::from(available) - i64::from(size)).max(0) / 2)
                .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
        };
        (
            centered(self.x, self.width, width),
            centered(self.y, self.height, height),
        )
    }
}
impl From<&tauri::Monitor> for DesktopRect {
    fn from(monitor: &tauri::Monitor) -> Self {
        Self {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn negative_origin_mixed_dpi_geometry_stays_physical() {
        // Simulated monitor layouts at 100/125/150/200%, not hardware validation.
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let width = (1920.0 * scale) as u32;
            let height = (1080.0 * scale) as u32;
            let monitor = DesktopRect {
                x: -(width as i32),
                y: -400,
                width,
                height,
            };
            let frame = DesktopRect {
                x: monitor.x,
                y: -400,
                width: width + 2560,
                height: height.max(1840),
            };
            assert_eq!(monitor.crop_inside(frame), Some((0, 0, width, height)));
            assert!(monitor.contains((monitor.x, -400)));
            assert!(!monitor.contains((0, 0))); // seam belongs to the next monitor
            let gap = DesktopRect {
                x: 100,
                y: 0,
                width: 2560,
                height: 1440,
            };
            assert!(!gap.contains((50, 0)));
            let pos = monitor.center_window(400, 200);
            assert!(monitor.contains(pos));
            assert!(monitor.contains((pos.0 + 399, pos.1 + 199)));
        }
    }
    #[test]
    fn topology_changes_cannot_wrap_negative_crop_or_include_other_monitors() {
        let primary = DesktopRect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        };
        let removed = DesktopRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(removed.crop_inside(primary), None);
        let partial = DesktopRect {
            x: -100,
            y: 100,
            width: 500,
            height: 600,
        };
        assert_eq!(partial.clipped_to(primary), Some((0, 100, 400, 600)));
        assert_eq!(partial.crop_inside(primary), None);
        let extreme = DesktopRect {
            x: i32::MAX - 20,
            y: 0,
            width: 100,
            height: 10,
        };
        assert!(extreme.contains((i32::MAX, 1)));
        assert!(!extreme.contains((i32::MIN, 1)));
    }
}
