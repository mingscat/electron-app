use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::io::Cursor;
use image::GenericImageView;

/// 显示器信息
#[napi(object)]
#[derive(Clone)]
pub struct DisplayInfo {
    /// 显示器唯一ID
    pub id: String,
    /// 显示器名称
    pub name: String,
    /// 显示器左上角X坐标
    pub x: i32,
    /// 显示器左上角Y坐标
    pub y: i32,
    /// 显示器宽度
    pub width: u32,
    /// 显示器高度
    pub height: u32,
    /// 缩放因子 (DPI缩放)
    pub scale_factor: f64,
    /// 是否为主显示器
    pub is_primary: bool,
}

/// 图像数据
#[napi(object)]
pub struct ImageData {
    /// PNG编码的图像数据
    pub data: Buffer,
    /// 图像宽度
    pub width: u32,
    /// 图像高度
    pub height: u32,
}

/// 区域参数
#[napi(object)]
pub struct Area {
    /// 左上角X坐标
    pub x: i32,
    /// 左上角Y坐标
    pub y: i32,
    /// 宽度
    pub width: u32,
    /// 高度
    pub height: u32,
}

/// 获取所有显示器信息
#[napi]
pub fn get_displays() -> Result<Vec<DisplayInfo>> {
    let monitors = xcap::Monitor::all()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitors: {}", e)))?;

    let mut displays = Vec::new();

    for monitor in monitors {
        let name = monitor.name()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor name: {}", e)))?;
        let id_num = monitor.id()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor id: {}", e)))?;
        let x = monitor.x()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor x: {}", e)))?;
        let y = monitor.y()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor y: {}", e)))?;
        let width = monitor.width()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor width: {}", e)))?;
        let height = monitor.height()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor height: {}", e)))?;
        let scale_factor = monitor.scale_factor()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor scale: {}", e)))?;

        let id = format!("{}-{}-{}x{}@{},{}",
            name,
            id_num,
            width,
            height,
            x,
            y
        );

        displays.push(DisplayInfo {
            id,
            name,
            x,
            y,
            width,
            height,
            scale_factor: scale_factor as f64,
            is_primary: monitor.is_primary()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor is_primary: {}", e)))?,
        });
    }

    Ok(displays)
}

/// 截图指定显示器
#[napi]
pub fn capture_display(display_id: String) -> Result<Option<ImageData>> {
    let monitors = xcap::Monitor::all()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitors: {}", e)))?;

    for monitor in monitors {
        let name = monitor.name()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor name: {}", e)))?;
        let id_num = monitor.id()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor id: {}", e)))?;
        let x = monitor.x()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor x: {}", e)))?;
        let y = monitor.y()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor y: {}", e)))?;
        let width = monitor.width()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor width: {}", e)))?;
        let height = monitor.height()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor height: {}", e)))?;

        let id = format!("{}-{}-{}x{}@{},{}",
            name,
            id_num,
            width,
            height,
            x,
            y
        );

        if id == display_id {
            let image = monitor.capture_image()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to capture display: {}", e)))?;

            let width = image.width();
            let height = image.height();

            // 将图像编码为PNG
            let mut png_data = Vec::new();
            {
                let mut cursor = Cursor::new(&mut png_data);
                image.write_to(&mut cursor, image::ImageFormat::Png)
                    .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to encode PNG: {}", e)))?;
            }

            return Ok(Some(ImageData {
                data: Buffer::from(png_data),
                width,
                height,
            }));
        }
    }

    Ok(None)
}

/// 截图指定区域（可能跨显示器）
#[napi]
pub fn capture_area(area: Area) -> Result<ImageData> {
    let monitors = xcap::Monitor::all()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitors: {}", e)))?;

    // 计算需要捕获的显示器
    let area_right = area.x + area.width as i32;
    let area_bottom = area.y + area.height as i32;

    // 找到与目标区域相交的显示器
    let mut target_monitor = None;
    for monitor in &monitors {
        let mon_x = monitor.x()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor x: {}", e)))?;
        let mon_y = monitor.y()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor y: {}", e)))?;
        let mon_width = monitor.width()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor width: {}", e)))?;
        let mon_height = monitor.height()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor height: {}", e)))?;

        let mon_right = mon_x + mon_width as i32;
        let mon_bottom = mon_y + mon_height as i32;

        // 检查是否相交
        if area.x < mon_right && area_right > mon_x &&
           area.y < mon_bottom && area_bottom > mon_y {
            target_monitor = Some(monitor.clone());
            break;
        }
    }

    let monitor = target_monitor.ok_or_else(||
        Error::new(Status::InvalidArg, "No monitor found for the specified area".to_string())
    )?;

    // 捕获整个显示器
    let full_image = monitor.capture_image()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to capture: {}", e)))?;

    let mon_x = monitor.x()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor x: {}", e)))?;
    let mon_y = monitor.y()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor y: {}", e)))?;

    // 计算相对于显示器的裁剪区域
    let crop_x = (area.x - mon_x).max(0) as u32;
    let crop_y = (area.y - mon_y).max(0) as u32;
    let crop_width = area.width.min(full_image.width() - crop_x);
    let crop_height = area.height.min(full_image.height() - crop_y);

    if crop_width == 0 || crop_height == 0 {
        return Err(Error::new(Status::InvalidArg, "Invalid crop area".to_string()));
    }

    // 裁剪图像
    let cropped = full_image.view(crop_x, crop_y, crop_width, crop_height).to_image();

    // 编码为PNG
    let mut png_data = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_data);
        cropped.write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to encode PNG: {}", e)))?;
    }

    Ok(ImageData {
        data: Buffer::from(png_data),
        width: crop_width,
        height: crop_height,
    })
}

/// 截图所有显示器并合并为一张大图
#[napi]
pub fn capture_all_displays() -> Result<ImageData> {
    let monitors = xcap::Monitor::all()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitors: {}", e)))?;

    if monitors.is_empty() {
        return Err(Error::new(Status::GenericFailure, "No monitors found".to_string()));
    }

    // 计算虚拟桌面边界
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for monitor in &monitors {
        let x = monitor.x()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor x: {}", e)))?;
        let y = monitor.y()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor y: {}", e)))?;
        let width = monitor.width()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor width: {}", e)))?;
        let height = monitor.height()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor height: {}", e)))?;

        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + width as i32);
        max_y = max_y.max(y + height as i32);
    }

    let total_width = (max_x - min_x) as u32;
    let total_height = (max_y - min_y) as u32;

    if total_width == 0 || total_height == 0 {
        return Err(Error::new(Status::GenericFailure, "Invalid display bounds".to_string()));
    }

    // 创建空白画布
    let mut canvas = image::RgbaImage::new(total_width, total_height);

    // 逐个捕获并绘制
    for monitor in &monitors {
        let image = monitor.capture_image()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to capture monitor: {}", e)))?;

        let x = monitor.x()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor x: {}", e)))?;
        let y = monitor.y()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to get monitor y: {}", e)))?;

        // 计算在画布上的位置
        let offset_x = (x - min_x) as u32;
        let offset_y = (y - min_y) as u32;

        // 绘制到画布 - 使用图像的实际尺寸
        for (img_x, img_y, pixel) in image.enumerate_pixels() {
            let canvas_x = offset_x + img_x;
            let canvas_y = offset_y + img_y;
            if canvas_x < total_width && canvas_y < total_height {
                canvas.put_pixel(canvas_x, canvas_y, *pixel);
            }
        }
    }

    // 编码为PNG
    let mut png_data = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_data);
        canvas.write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to encode PNG: {}", e)))?;
    }

    Ok(ImageData {
        data: Buffer::from(png_data),
        width: total_width,
        height: total_height,
    })
}

/// 将图像数据保存为文件
#[napi]
pub fn save_to_file(data: Buffer, path: String) -> Result<()> {
    std::fs::write(&path, &data)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to write file: {}", e)))?;
    Ok(())
}
