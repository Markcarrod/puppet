import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
NODE_SCRIPT = ROOT / "scripts" / "batchRender.js"


class PinFactoryDesktop:
    def __init__(self, root):
        self.root = root
        self.root.title("Pin Factory Desktop")
        self.root.geometry("860x700")
        self.root.minsize(760, 620)
        self.root.configure(bg="#101017")

        self.log_queue = queue.Queue()
        self.process = None

        self.images_dir = tk.StringVar()
        self.titles_file = tk.StringVar()
        self.output_dir = tk.StringVar(value=str(OUTPUT_DIR))
        self.template_mode = tk.StringVar(value="auto")
        self.pin_size = tk.StringVar(value="standard")
        self.output_format = tk.StringVar(value="jpg")
        self.quality = tk.StringVar(value="88")
        self.variants = tk.StringVar(value="1")
        self.concurrency = tk.StringVar(value="3")
        self.status_text = tk.StringVar(value="Ready")

        self._build_ui()
        self.root.after(120, self._drain_log_queue)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure("Root.TFrame", background="#101017")
        style.configure("Card.TFrame", background="#181822")
        style.configure("Heading.TLabel", background="#101017", foreground="#f4f4fa", font=("Segoe UI", 20, "bold"))
        style.configure("Sub.TLabel", background="#101017", foreground="#9d9db6", font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background="#181822", foreground="#f4f4fa", font=("Segoe UI", 11, "bold"))
        style.configure("Body.TLabel", background="#181822", foreground="#d6d6e6", font=("Segoe UI", 10))
        style.configure("Meta.TLabel", background="#181822", foreground="#9d9db6", font=("Segoe UI", 9))
        style.configure("Status.TLabel", background="#101017", foreground="#b7b7cd", font=("Segoe UI", 10, "bold"))
        style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"))
        style.configure("Ghost.TButton", font=("Segoe UI", 9))
        style.configure("TCombobox", fieldbackground="#11111a", background="#11111a", foreground="#f4f4fa")

        container = ttk.Frame(self.root, style="Root.TFrame", padding=18)
        container.pack(fill="both", expand=True)

        ttk.Label(container, text="Pin Factory Desktop", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(
            container,
            text="Folder-based batch rendering with native pickers for images and title banks.",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(2, 16))

        self._make_paths_card(container)
        self._make_settings_card(container)
        self._make_actions(container)
        self._make_log_card(container)

    def _make_paths_card(self, parent):
        card = ttk.Frame(parent, style="Card.TFrame", padding=16)
        card.pack(fill="x", pady=(0, 14))
        ttk.Label(card, text="Input Paths", style="CardTitle.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 12))

        self._path_row(card, 1, "Images Folder", self.images_dir, self.pick_images_folder)
        self._path_row(card, 2, "Titles .txt", self.titles_file, self.pick_titles_file)
        self._path_row(card, 3, "Output Folder", self.output_dir, self.pick_output_folder)

        card.columnconfigure(1, weight=1)

    def _path_row(self, parent, row, label, variable, command):
        ttk.Label(parent, text=label, style="Body.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=7)
        entry = tk.Entry(
            parent,
            textvariable=variable,
            bg="#11111a",
            fg="#f4f4fa",
            insertbackground="#f4f4fa",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#29293a",
            highlightcolor="#6f62ff",
            font=("Segoe UI", 10),
        )
        entry.grid(row=row, column=1, sticky="ew", pady=7, ipady=6)
        ttk.Button(parent, text="Browse", command=command, style="Ghost.TButton").grid(row=row, column=2, padx=(10, 0), pady=7)

    def _make_settings_card(self, parent):
        card = ttk.Frame(parent, style="Card.TFrame", padding=16)
        card.pack(fill="x", pady=(0, 14))
        ttk.Label(card, text="Render Settings", style="CardTitle.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 12), columnspan=4)

        self._field(card, 1, 0, "Template", ttk.Combobox(card, textvariable=self.template_mode, values=[
            "auto",
            "luxury_desk_headline",
            "center_white_sheet",
            "lower_third_card",
            "floating_soft_panel",
            "upper_third_overlay",
            "top_middle_headline",
            "gradient_editorial",
            "premium_article_cover",
            "left_editorial_column",
            "minimalist_gradient_poster",
            "soft_magazine",
        ], state="readonly"))
        self._field(card, 1, 2, "Pin Size", ttk.Combobox(card, textvariable=self.pin_size, values=["standard", "tall", "square_ish", "square"], state="readonly"))
        self._field(card, 2, 0, "Format", ttk.Combobox(card, textvariable=self.output_format, values=["jpg", "png", "webp"], state="readonly"))
        self._field(card, 2, 2, "Quality", self._entry(card, self.quality))
        self._field(card, 3, 0, "Variants", self._entry(card, self.variants))
        self._field(card, 3, 2, "Concurrency", self._entry(card, self.concurrency))

        for col in (1, 3):
            card.columnconfigure(col, weight=1)

    def _field(self, parent, row, col, label, widget):
        ttk.Label(parent, text=label, style="Body.TLabel").grid(row=row, column=col, sticky="w", padx=(0, 10), pady=7)
        widget.grid(row=row, column=col + 1, sticky="ew", pady=7)

    def _entry(self, parent, variable):
        return tk.Entry(
            parent,
            textvariable=variable,
            bg="#11111a",
            fg="#f4f4fa",
            insertbackground="#f4f4fa",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#29293a",
            highlightcolor="#6f62ff",
            font=("Segoe UI", 10),
        )

    def _make_actions(self, parent):
        row = ttk.Frame(parent, style="Root.TFrame")
        row.pack(fill="x", pady=(0, 12))

        ttk.Button(row, text="Start Batch Render", command=self.start_render, style="Accent.TButton").pack(side="left")
        ttk.Button(row, text="Stop", command=self.stop_render, style="Ghost.TButton").pack(side="left", padx=(10, 0))
        ttk.Button(row, text="Open Output Folder", command=self.open_output_folder, style="Ghost.TButton").pack(side="left", padx=(10, 0))
        ttk.Label(row, textvariable=self.status_text, style="Status.TLabel").pack(side="right")

        self.progress = ttk.Progressbar(parent, mode="indeterminate")
        self.progress.pack(fill="x", pady=(0, 14))

    def _make_log_card(self, parent):
        card = ttk.Frame(parent, style="Card.TFrame", padding=16)
        card.pack(fill="both", expand=True)
        ttk.Label(card, text="Run Log", style="CardTitle.TLabel").pack(anchor="w", pady=(0, 10))

        self.log_text = tk.Text(
            card,
            bg="#0c0c12",
            fg="#e9e9f4",
            insertbackground="#ffffff",
            relief="flat",
            wrap="word",
            font=("Consolas", 10),
        )
        self.log_text.pack(fill="both", expand=True, side="left")

        scrollbar = ttk.Scrollbar(card, orient="vertical", command=self.log_text.yview)
        scrollbar.pack(fill="y", side="right")
        self.log_text.configure(yscrollcommand=scrollbar.set)

    def pick_images_folder(self):
        folder = filedialog.askdirectory(title="Choose image folder")
        if folder:
            self.images_dir.set(folder)

    def pick_titles_file(self):
        file_path = filedialog.askopenfilename(title="Choose titles file", filetypes=[("Text files", "*.txt")])
        if file_path:
            self.titles_file.set(file_path)

    def pick_output_folder(self):
        folder = filedialog.askdirectory(title="Choose output folder")
        if folder:
            self.output_dir.set(folder)

    def start_render(self):
        if self.process and self.process.poll() is None:
            messagebox.showinfo("Already running", "A batch render is already in progress.")
            return

        if not self.images_dir.get().strip():
            messagebox.showerror("Missing folder", "Choose an images folder first.")
            return
        if not self.titles_file.get().strip():
            messagebox.showerror("Missing titles", "Choose a titles .txt file first.")
            return

        try:
            variants = max(1, int(self.variants.get().strip() or "1"))
            quality = min(100, max(60, int(self.quality.get().strip() or "88")))
            concurrency = max(1, int(self.concurrency.get().strip() or "3"))
        except ValueError:
            messagebox.showerror("Invalid settings", "Variants, quality, and concurrency must be numbers.")
            return

        cmd = [
            "node",
            str(NODE_SCRIPT),
            "--folder", self.images_dir.get().strip(),
            "--titles", self.titles_file.get().strip(),
            "--template", self.template_mode.get().strip(),
            "--size", self.pin_size.get().strip(),
            "--format", self.output_format.get().strip(),
            "--quality", str(quality),
            "--variants", str(variants),
            "--concurrency", str(concurrency),
            "--output", self.output_dir.get().strip(),
        ]

        self.log_text.delete("1.0", "end")
        self._append_log("Starting batch render...\n")
        self._append_log(" ".join(cmd) + "\n\n")
        self.status_text.set("Running")
        self.progress.start(10)

        def worker():
            try:
                self.process = subprocess.Popen(
                    cmd,
                    cwd=str(ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                for line in self.process.stdout:
                    self.log_queue.put(line)
                code = self.process.wait()
                self.log_queue.put(f"\nFinished with exit code {code}\n")
                self.log_queue.put(("__DONE__", code))
            except FileNotFoundError:
                self.log_queue.put("Could not find `node` on PATH.\n")
                self.log_queue.put(("__DONE__", 1))
            except Exception as exc:
                self.log_queue.put(f"Desktop runner error: {exc}\n")
                self.log_queue.put(("__DONE__", 1))

        threading.Thread(target=worker, daemon=True).start()

    def stop_render(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self._append_log("\nStopping process...\n")

    def open_output_folder(self):
        output_path = self.output_dir.get().strip() or str(OUTPUT_DIR)
        os.makedirs(output_path, exist_ok=True)
        os.startfile(output_path)

    def _append_log(self, text):
        self.log_text.insert("end", text)
        self.log_text.see("end")

    def _drain_log_queue(self):
        try:
            while True:
                item = self.log_queue.get_nowait()
                if isinstance(item, tuple) and item[0] == "__DONE__":
                    self.progress.stop()
                    self.status_text.set("Done" if item[1] == 0 else "Failed")
                else:
                    self._append_log(item)
        except queue.Empty:
            pass
        self.root.after(120, self._drain_log_queue)

    def _on_close(self):
        if self.process and self.process.poll() is None:
            if not messagebox.askyesno("Quit", "A render is still running. Stop it and quit?"):
                return
            self.process.terminate()
        self.root.destroy()


def main():
    app = tk.Tk()
    PinFactoryDesktop(app)
    app.mainloop()


if __name__ == "__main__":
    main()
