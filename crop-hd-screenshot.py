import argparse
import os
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

from PIL import Image, ImageTk
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdf_canvas


def parse_args():
    parser = argparse.ArgumentParser(description="从高清整屏截图中精确框选裁剪 PNG 和 PDF。")
    parser.add_argument("image", help="输入的高清整屏 PNG/JPG 文件")
    parser.add_argument("--out", default="", help="输出目录，默认使用输入图片所在目录")
    parser.add_argument("--prefix", default="", help="输出文件名前缀，默认使用输入图片文件名")
    parser.add_argument("--dpi", type=int, default=300, help="PDF 内嵌图片按多少 DPI 计算页面尺寸，默认 300")
    return parser.parse_args()


class CropApp:
    def __init__(self, root, image_path, out_dir, prefix, dpi):
        self.root = root
        self.image_path = Path(image_path)
        self.out_dir = Path(out_dir) if out_dir else self.image_path.parent
        self.prefix = prefix or self.image_path.stem
        self.dpi = dpi

        self.image = Image.open(self.image_path).convert("RGB")
        self.img_w, self.img_h = self.image.size

        screen_w = root.winfo_screenwidth()
        screen_h = root.winfo_screenheight()
        max_w = max(800, screen_w - 160)
        max_h = max(500, screen_h - 220)
        self.scale = min(max_w / self.img_w, max_h / self.img_h, 1.0)
        self.view_w = int(self.img_w * self.scale)
        self.view_h = int(self.img_h * self.scale)

        self.view_image = self.image.resize((self.view_w, self.view_h), Image.LANCZOS)
        self.photo = ImageTk.PhotoImage(self.view_image)

        self.start_x = None
        self.start_y = None
        self.rect_id = None
        self.selection = None

        root.title("通用高清网页截图裁剪器")
        root.geometry(f"{self.view_w}x{self.view_h + 88}")

        self.canvas = tk.Canvas(root, width=self.view_w, height=self.view_h, cursor="crosshair", highlightthickness=0)
        self.canvas.pack(side=tk.TOP, fill=tk.BOTH, expand=False)
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.photo)

        panel = tk.Frame(root)
        panel.pack(side=tk.BOTTOM, fill=tk.X)

        self.info = tk.Label(
            panel,
            text="在图片上拖拽框选区域。按 S 保存，按 R 重选，按 Esc 退出。",
            anchor="w",
        )
        self.info.pack(side=tk.LEFT, padx=10, pady=10, fill=tk.X, expand=True)

        tk.Button(panel, text="保存 PNG+PDF (S)", command=self.save_selection).pack(side=tk.RIGHT, padx=6, pady=8)
        tk.Button(panel, text="重选 (R)", command=self.clear_selection).pack(side=tk.RIGHT, padx=6, pady=8)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        root.bind("<s>", lambda _: self.save_selection())
        root.bind("<S>", lambda _: self.save_selection())
        root.bind("<r>", lambda _: self.clear_selection())
        root.bind("<R>", lambda _: self.clear_selection())
        root.bind("<Escape>", lambda _: root.destroy())

    def view_to_image_rect(self, x1, y1, x2, y2):
        left = max(0, min(x1, x2))
        top = max(0, min(y1, y2))
        right = min(self.view_w, max(x1, x2))
        bottom = min(self.view_h, max(y1, y2))
        img_left = round(left / self.scale)
        img_top = round(top / self.scale)
        img_right = round(right / self.scale)
        img_bottom = round(bottom / self.scale)
        img_left = max(0, min(img_left, self.img_w - 1))
        img_top = max(0, min(img_top, self.img_h - 1))
        img_right = max(img_left + 1, min(img_right, self.img_w))
        img_bottom = max(img_top + 1, min(img_bottom, self.img_h))
        return img_left, img_top, img_right, img_bottom

    def on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        self.rect_id = self.canvas.create_rectangle(
            self.start_x,
            self.start_y,
            self.start_x,
            self.start_y,
            outline="#2563eb",
            width=2,
        )

    def on_drag(self, event):
        if self.rect_id is None:
            return
        x = max(0, min(event.x, self.view_w))
        y = max(0, min(event.y, self.view_h))
        self.canvas.coords(self.rect_id, self.start_x, self.start_y, x, y)
        rect = self.view_to_image_rect(self.start_x, self.start_y, x, y)
        self.info.config(text=f"当前选择像素区域：x={rect[0]}, y={rect[1]}, w={rect[2]-rect[0]}, h={rect[3]-rect[1]}")

    def on_release(self, event):
        if self.rect_id is None:
            return
        x = max(0, min(event.x, self.view_w))
        y = max(0, min(event.y, self.view_h))
        rect = self.view_to_image_rect(self.start_x, self.start_y, x, y)
        if rect[2] - rect[0] < 20 or rect[3] - rect[1] < 20:
            self.selection = None
            self.info.config(text="选择区域太小，请重新拖拽。")
            return
        self.selection = rect
        self.info.config(text=f"已选择：x={rect[0]}, y={rect[1]}, w={rect[2]-rect[0]}, h={rect[3]-rect[1]}。按 S 保存。")

    def clear_selection(self):
        self.selection = None
        if self.rect_id:
            self.canvas.delete(self.rect_id)
            self.rect_id = None
        self.info.config(text="已清除选择，请重新拖拽框选区域。")

    def save_selection(self):
        if not self.selection:
            messagebox.showwarning("未选择区域", "请先在图片上拖拽框选要裁剪的区域。")
            return

        self.out_dir.mkdir(parents=True, exist_ok=True)
        left, top, right, bottom = self.selection
        crop = self.image.crop((left, top, right, bottom))
        crop_w, crop_h = crop.size
        base = f"{self.prefix}_crop_x{left}_y{top}_w{crop_w}_h{crop_h}"
        png_path = self.out_dir / f"{base}.png"
        pdf_path = self.out_dir / f"{base}.pdf"

        crop.save(png_path)
        page_w = crop_w * 72 / self.dpi
        page_h = crop_h * 72 / self.dpi
        c = pdf_canvas.Canvas(str(pdf_path), pagesize=(page_w, page_h))
        c.drawImage(ImageReader(crop), 0, 0, width=page_w, height=page_h)
        c.showPage()
        c.save()

        self.info.config(text=f"已保存：{png_path.name} 和 {pdf_path.name}")
        print(f"裁剪PNG：{png_path}")
        print(f"裁剪PDF：{pdf_path}")
        print(f"裁剪区域：x={left}, y={top}, width={crop_w}, height={crop_h}")
        messagebox.showinfo("保存完成", f"已保存：\n{png_path}\n{pdf_path}")


def main():
    args = parse_args()
    image_path = Path(args.image)
    if not image_path.exists():
        raise FileNotFoundError(f"找不到输入图片：{image_path}")

    root = tk.Tk()
    CropApp(root, image_path, args.out, args.prefix, args.dpi)
    root.mainloop()


if __name__ == "__main__":
    main()
