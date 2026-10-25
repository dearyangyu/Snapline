//! Drag-image math and pixels. Desktop positions are physical; only source
//! photo dimensions/velocity use the fixed source-monitor scale.
use crate::library::Result;
use image::{GrayImage, ImageBuffer, RgbaImage};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragVisual {
    pub width_dip: f64,
    pub height_dip: f64,
    pub grab_x: f64,
    pub grab_y: f64,
    pub angle_deg: f64,
    pub reduced_motion: bool,
}
impl DragVisual {
    pub fn valid(&self) -> bool {
        [
            self.width_dip,
            self.height_dip,
            self.grab_x,
            self.grab_y,
            self.angle_deg,
        ]
        .iter()
        .all(|n| n.is_finite())
            && (1.0..=512.0).contains(&self.width_dip)
            && (1.0..=512.0).contains(&self.height_dip)
    }
}
pub struct Sway {
    pub angle: f64,
    angular_velocity: f64,
    velocity: f64,
    last: (i32, i32),
    scale: f64,
    reduced: bool,
}
impl Sway {
    pub fn new(point: (i32, i32), scale: f64, angle: f64, reduced: bool) -> Self {
        Self {
            angle: if reduced {
                0.0
            } else {
                angle.clamp(-24.0, 24.0)
            },
            angular_velocity: 0.0,
            velocity: 0.0,
            last: point,
            scale: scale.clamp(0.5, 8.0),
            reduced,
        }
    }
    pub fn step(&mut self, point: (i32, i32), seconds: f64) {
        let elapsed = seconds.clamp(0.001, 0.1);
        let dx = (f64::from(point.0) - f64::from(self.last.0)) / self.scale;
        self.last = point;
        if self.reduced {
            self.angle = 0.0;
            self.angular_velocity = 0.0;
            return;
        }
        let velocity = (dx / elapsed).clamp(-1400.0, 1400.0);
        self.velocity += (velocity - self.velocity) * (1.0 - (-elapsed / 0.045).exp());
        let target = (self.velocity * 0.022).clamp(-18.0, 18.0);
        let steps = (elapsed / 0.008).ceil() as usize;
        let dt = elapsed / steps as f64;
        for _ in 0..steps {
            self.angular_velocity +=
                ((target - self.angle) * 145.0 - self.angular_velocity * 17.0) * dt;
            self.angle = (self.angle + self.angular_velocity * dt).clamp(-24.0, 24.0);
        }
    }
}

pub struct DragCanvas {
    image: RgbaImage, // premultiplied RGBA, deliberately not Shell's straight RGBA
    shadow: GrayImage,
    shadow_pad: f64,
    shadow_offset: f64,
    grab: (f64, f64),
    pub size: u32,
}
impl DragCanvas {
    pub fn from_png(png: &[u8], visual: DragVisual, scale: f64) -> Result<Self> {
        if !visual.valid() || !scale.is_finite() || png.len() > 4 * 1024 * 1024 {
            return Err("拖动影像参数无效".into());
        }
        let mut reader =
            image::ImageReader::with_format(std::io::Cursor::new(png), image::ImageFormat::Png);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(1024);
        limits.max_image_height = Some(1024);
        limits.max_alloc = Some(8 * 1024 * 1024);
        reader.limits(limits);
        let mut image = reader.decode().map_err(|_| "拖动影像不可用")?.into_rgba8();
        for pixel in image.pixels_mut() {
            let alpha = u16::from(pixel[3]);
            for c in 0..3 {
                pixel[c] = ((u16::from(pixel[c]) * alpha + 127) / 255) as u8;
            }
        }
        let width = (visual.width_dip * scale.clamp(0.5, 8.0))
            .round()
            .clamp(1.0, 640.0);
        let height = (visual.height_dip * scale.clamp(0.5, 8.0))
            .round()
            .clamp(1.0, 640.0);
        // Keep the source aspect ratio; source metadata sizes can differ slightly
        // due to CSS rounding. Never crop a portrait/panorama to a cover rectangle.
        let fit = (width / f64::from(image.width())).min(height / f64::from(image.height()));
        let w = (f64::from(image.width()) * fit).round().max(1.0) as u32;
        let h = (f64::from(image.height()) * fit).round().max(1.0) as u32;
        let image = image::imageops::resize(&image, w, h, image::imageops::FilterType::Triangle);
        let pad = (12.0 * scale).round().clamp(12.0, 32.0) as u32;
        let shadow_offset = (4.0 * scale).clamp(3.0, 10.0);
        let mut alpha = GrayImage::new(w + 2 * pad, h + 2 * pad);
        for (x, y, pixel) in image.enumerate_pixels() {
            alpha.put_pixel(x + pad, y + pad, image::Luma([pixel[3]]));
        }
        let shadow = image::imageops::blur(&alpha, (3.5 * scale).clamp(2.0, 8.0) as f32);
        let size =
            (f64::from(w).hypot(f64::from(h)) + 2.0 * f64::from(pad) + 2.0 * shadow_offset + 4.0)
                .ceil() as u32;
        Ok(Self {
            image,
            shadow,
            shadow_pad: f64::from(pad),
            shadow_offset,
            grab: (
                (visual.grab_x.clamp(0.0, 1.0) - 0.5) * f64::from(w),
                (visual.grab_y.clamp(0.0, 1.0) - 0.5) * f64::from(h),
            ),
            size,
        })
    }
    pub fn origin(&self, point: (i32, i32), angle: f64) -> (i32, i32) {
        let (sin, cos) = angle.to_radians().sin_cos();
        let x =
            f64::from(point.0) - f64::from(self.size) / 2.0 - self.grab.0 * cos + self.grab.1 * sin;
        let y =
            f64::from(point.1) - f64::from(self.size) / 2.0 - self.grab.0 * sin - self.grab.1 * cos;
        (
            x.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32,
            y.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32,
        )
    }
    pub fn render(&self, angle: f64, output: &mut [u8]) {
        let (sin, cos) = angle.to_radians().sin_cos();
        let center = f64::from(self.size) / 2.0;
        let half_w = f64::from(self.image.width()) / 2.0;
        let half_h = f64::from(self.image.height()) / 2.0;
        for y in 0..self.size {
            for x in 0..self.size {
                let px = f64::from(x) + 0.5 - center;
                let py = f64::from(y) + 0.5 - center;
                let sx = px * cos + py * sin + half_w - 0.5;
                let sy = -px * sin + py * cos + half_h - 0.5;
                let rgba = sample::<4>(&self.image, sx, sy);
                let shadow = sample::<1>(
                    &self.shadow,
                    sx - self.shadow_offset * sin + self.shadow_pad,
                    sy - self.shadow_offset * cos + self.shadow_pad,
                )[0] * 0.25;
                let alpha = (rgba[3] + shadow * (1.0 - rgba[3] / 255.0))
                    .round()
                    .clamp(0.0, 255.0) as u8;
                let dest = ((y * self.size + x) * 4) as usize;
                output[dest..dest + 4].copy_from_slice(&[
                    rgba[2].round().clamp(0.0, f64::from(alpha)) as u8,
                    rgba[1].round().clamp(0.0, f64::from(alpha)) as u8,
                    rgba[0].round().clamp(0.0, f64::from(alpha)) as u8,
                    alpha,
                ]);
            }
        }
    }
}
fn sample<const N: usize>(
    image: &ImageBuffer<impl image::Pixel<Subpixel = u8>, Vec<u8>>,
    x: f64,
    y: f64,
) -> [f64; N] {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - f64::from(ix);
    let fy = y - f64::from(iy);
    let mut result = [0.0; N];
    for (dx, wx) in [(0, 1.0 - fx), (1, fx)] {
        for (dy, wy) in [(0, 1.0 - fy), (1, fy)] {
            let px = ix + dx;
            let py = iy + dy;
            if px < 0 || py < 0 || px >= image.width() as i32 || py >= image.height() as i32 {
                continue;
            }
            let pixel = image.get_pixel(px as u32, py as u32);
            for (channel, value) in result.iter_mut().zip(image::Pixel::channels(pixel)) {
                *channel += f64::from(*value) * wx * wy;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn canvas(width: u32, height: u32, grab: (f64, f64), scale: f64) -> DragCanvas {
        let image = RgbaImage::from_pixel(width, height, image::Rgba([240, 80, 40, 128]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        DragCanvas::from_png(
            bytes.get_ref(),
            DragVisual {
                width_dip: f64::from(width),
                height_dip: f64::from(height),
                grab_x: grab.0,
                grab_y: grab.1,
                angle_deg: 0.0,
                reduced_motion: false,
            },
            scale,
        )
        .unwrap()
    }
    #[test]
    fn real_direction_changes_tilt_then_rest_settles_without_a_periodic_animation() {
        let mut sway = Sway::new((0, 0), 1.0, 0.0, false);
        for i in 1..=15 {
            sway.step((i * 12, 0), 0.016);
        }
        assert!(sway.angle > 7.0);
        for i in 1..=25 {
            sway.step((180 - i * 12, 0), 0.016);
        }
        assert!(sway.angle < -7.0);
        for _ in 0..150 {
            sway.step((-120, 0), 0.016);
        }
        assert!(sway.angle.abs() < 0.01);
    }
    #[test]
    fn reduced_motion_is_zero_rotation_even_under_rapid_real_position_changes() {
        let mut sway = Sway::new((0, 0), 2.0, 15.0, true);
        for i in 1..=100 {
            sway.step(((i % 2) * 4000 - 3000, i * 20), 0.016);
            assert_eq!(sway.angle, 0.0);
        }
    }
    #[test]
    fn grabbed_point_stays_at_cursor_across_rotation_negative_monitors_and_scales() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let canvas = canvas(120, 80, (0.15, 0.8), scale);
            for angle in [-24.0_f64, 0.0, 24.0] {
                let cursor = (-2310, -360);
                let (x, y) = canvas.origin(cursor, angle);
                let (sin, cos) = angle.to_radians().sin_cos();
                assert!(
                    (f64::from(x) + f64::from(canvas.size) / 2.0 + canvas.grab.0 * cos
                        - canvas.grab.1 * sin
                        - f64::from(cursor.0))
                    .abs()
                        <= 0.51
                );
                assert!(
                    (f64::from(y)
                        + f64::from(canvas.size) / 2.0
                        + canvas.grab.0 * sin
                        + canvas.grab.1 * cos
                        - f64::from(cursor.1))
                    .abs()
                        <= 0.51
                );
            }
        }
    }
    #[test]
    fn alpha_is_premultiplied_and_rotated_portrait_panorama_corners_never_clip() {
        for (w, h) in [(120, 20), (20, 120), (120, 80)] {
            let canvas = canvas(w, h, (0.5, 0.5), 1.0);
            let mut pixels = vec![0; (canvas.size * canvas.size * 4) as usize];
            for angle in [-24.0, 0.0, 24.0] {
                canvas.render(angle, &mut pixels);
                for p in pixels.as_chunks::<4>().0 {
                    assert!(p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]);
                }
                for i in 0..canvas.size {
                    for (x, y) in [(i, 0), (i, canvas.size - 1), (0, i), (canvas.size - 1, i)] {
                        assert_eq!(pixels[((y * canvas.size + x) * 4 + 3) as usize], 0);
                    }
                }
                let center = ((canvas.size / 2 * canvas.size + canvas.size / 2) * 4) as usize;
                assert!((pixels[center + 2] as i32 - 120).abs() <= 1); // Red 240 × alpha 128/255, once.
            }
        }
    }
}
