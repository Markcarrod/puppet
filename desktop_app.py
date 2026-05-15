import os
import platform
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import traceback
import json
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
NODE_SCRIPT = ROOT / "scripts" / "batchRender.js"
DEBUG_LOG = ROOT / "desktop_debug.log"
SETTINGS_FILE = ROOT / "desktop_settings.json"
APP_TITLE = "Pin Factory Desktop"

PROGRESS_RE = re.compile(
    r"Analyzed\s+(?P<analyzed>\d+)(?:/\d+)?\s+\|\s+Rendered\s+(?P<rendered>\d+)\s+\|\s+Failed\s+(?P<failed>\d+)\s+\|\s+Skipped\s+(?P<skipped>\d+)(?:\s+\|\s+(?P<extra>[^\r\n]*?))?(?=Analyzed|\Z)",
    re.IGNORECASE,
)
MS_RE = re.compile(r"-\s*(\d+)ms\b", re.IGNORECASE)


def write_debug(message):
    DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
    with DEBUG_LOG.open("a", encoding="utf-8") as handle:
        handle.write(message.rstrip() + "\n")


def now_timestamp():
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class PinFactoryDesktop:
    def __init__(self, root):
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("1180x820")
        self.root.minsize(980, 680)
        self.root.configure(bg="#101017")

        self.log_queue = queue.Queue()
        self.process = None
        self.is_paused = False
        self.title_bank_total = 0
        self.last_completed_units = 0
        self.render_ms_total = 0
        self.render_ms_samples = 0

        self.images_dir = tk.StringVar()
        self.titles_file = tk.StringVar()
        self.image_list_file = tk.StringVar()
        self.output_dir = tk.StringVar(value=str(OUTPUT_DIR))
        self.template_mode = tk.StringVar(value="auto")
        self.pin_size = tk.StringVar(value="standard")
        self.output_format = tk.StringVar(value="jpg")
        self.quality = tk.StringVar(value="88")
        self.variants = tk.StringVar(value="1")
        self.concurrency = tk.StringVar(value="5")
        self.resume_existing = tk.BooleanVar(value=True)
        self.log_title_text = tk.StringVar(value="Run Log")
        self.status_text = tk.StringVar(value="Ready")

        self._load_settings()
        self._build_ui()
        self._log_environment()
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
        style.configure("Heading.TLabel", background="#101017", foreground="#f4f4fa", font=("Segoe UI", 18, "bold"))
        style.configure("Sub.TLabel", background="#101017", foreground="#9d9db6", font=("Segoe UI", 9))
        style.configure("CardTitle.TLabel", background="#181822", foreground="#f4f4fa", font=("Segoe UI", 11, "bold"))
        style.configure("Body.TLabel", background="#181822", foreground="#d6d6e6", font=("Segoe UI", 9))
        style.configure("Meta.TLabel", background="#181822", foreground="#9d9db6", font=("Segoe UI", 9))
        style.configure("Status.TLabel", background="#101017", foreground="#b7b7cd", font=("Segoe UI", 10, "bold"))
        style.configure("Accent.TButton", font=("Segoe UI", 9, "bold"))
        style.configure("Ghost.TButton", font=("Segoe UI", 9))
        style.configure("TCheckbutton", background="#181822", foreground="#d6d6e6", font=("Segoe UI", 9))
        style.configure("TCombobox", fieldbackground="#11111a", background="#11111a", foreground="#f4f4fa")

        container = ttk.Frame(self.root, style="Root.TFrame", padding=14)
        container.pack(fill="both", expand=True)

        ttk.Label(container, text="Pin Factory Desktop", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(
            container,
            text="Folder-based batch rendering with native pickers, flat image output, shared JSON metadata, and title banks (including niche folders).",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(2, 10))

        top_row = ttk.Frame(container, style="Root.TFrame")
        top_row.pack(fill="x", pady=(0, 10))
        top_row.columnconfigure(0, weight=3)
        top_row.columnconfigure(1, weight=2)

        self._make_paths_card(top_row).grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        self._make_settings_card(top_row).grid(row=0, column=1, sticky="nsew")
        self._make_actions(container)
        self._make_log_card(container)

    def _make_paths_card(self, parent):
        card = ttk.Frame(parent, style="Card.TFrame", padding=16)
        ttk.Label(card, text="Input Paths", style="CardTitle.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 12))
        card.columnconfigure(0, weight=1)
        card.columnconfigure(1, weight=1)

        self._compact_path_block(card, 1, 0, "Images Folder", self.images_dir, self.pick_images_folder)
        self._compact_path_block(card, 1, 1, "Titles .txt", self.titles_file, self.pick_titles_file)
        self._compact_path_block(card, 2, 0, "Image List .txt", self.image_list_file, self.pick_image_list_file)
        self._compact_path_block(card, 2, 1, "Output Folder", self.output_dir, self.pick_output_folder)
        return card

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

    def _compact_path_block(self, parent, row, col, label, variable, command):
        block = ttk.Frame(parent, style="Card.TFrame")
        block.grid(row=row, column=col, sticky="ew", padx=(0, 10) if col == 0 else (10, 0), pady=4)
        block.columnconfigure(0, weight=1)
        ttk.Label(block, text=label, style="Body.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 4))
        entry = tk.Entry(
            block,
            textvariable=variable,
            bg="#11111a",
            fg="#f4f4fa",
            insertbackground="#f4f4fa",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#29293a",
            highlightcolor="#6f62ff",
            font=("Segoe UI", 9),
        )
        entry.grid(row=1, column=0, sticky="ew", ipady=5)
        ttk.Button(block, text="Browse", command=command, style="Ghost.TButton").grid(row=1, column=1, padx=(8, 0))

    def _make_settings_card(self, parent):
        card = ttk.Frame(parent, style="Card.TFrame", padding=16)
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
        self._field(card, 3, 2, "Workers", self._entry(card, self.concurrency))
        ttk.Checkbutton(
            card,
            text="Resume existing output",
            variable=self.resume_existing,
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=(4, 0))
        ttk.Label(
            card,
            text="Workers control how many Node render processes run in parallel across CPU cores.",
            style="Meta.TLabel",
        ).grid(row=5, column=0, columnspan=4, sticky="w", pady=(4, 0))

        for col in (1, 3):
            card.columnconfigure(col, weight=1)
        return card

    def _field(self, parent, row, col, label, widget):
        ttk.Label(parent, text=label, style="Body.TLabel").grid(row=row, column=col, sticky="w", padx=(0, 8), pady=5)
        widget.grid(row=row, column=col + 1, sticky="ew", pady=5)

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
            font=("Segoe UI", 9),
        )

    def _make_actions(self, parent):
        row = ttk.Frame(parent, style="Root.TFrame")
        row.pack(fill="x", pady=(0, 8))

        ttk.Button(row, text="Start Batch Render", command=self.start_render, style="Accent.TButton").pack(side="left")
        self.pause_button = ttk.Button(row, text="Pause", command=self.toggle_pause, style="Ghost.TButton", state="disabled")
        self.pause_button.pack(side="left", padx=(8, 0))
        ttk.Button(row, text="Stop", command=self.stop_render, style="Ghost.TButton").pack(side="left", padx=(8, 0))
        ttk.Button(row, text="Open Output Folder", command=self.open_output_folder, style="Ghost.TButton").pack(side="left", padx=(8, 0))
        ttk.Label(row, textvariable=self.status_text, style="Status.TLabel").pack(side="right")

        self.progress = ttk.Progressbar(parent, mode="indeterminate")
        self.progress.pack(fill="x", pady=(0, 10))

    def _make_log_card(self, parent):
        card = ttk.Frame(parent, style="Card.TFrame", padding=16)
        card.pack(fill="both", expand=True)
        ttk.Label(card, textvariable=self.log_title_text, style="CardTitle.TLabel").pack(anchor="w", pady=(0, 10))

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
            self._save_settings()

    def pick_titles_file(self):
        file_path = filedialog.askopenfilename(title="Choose titles file", filetypes=[("Text files", "*.txt")])
        if file_path:
            self.titles_file.set(file_path)
            self._save_settings()

    def pick_image_list_file(self):
        file_path = filedialog.askopenfilename(title="Choose image list file", filetypes=[("Text files", "*.txt")])
        if file_path:
            self.image_list_file.set(file_path)
            self._save_settings()

    def pick_output_folder(self):
        folder = filedialog.askdirectory(title="Choose output folder")
        if folder:
            self.output_dir.set(folder)
            self._save_settings()

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
            concurrency = max(1, int(self.concurrency.get().strip() or "5"))
        except ValueError:
            messagebox.showerror("Invalid settings", "Variants, quality, and workers must be numbers.")
            return

        self._save_settings()
        self._reset_run_metrics()
        self.title_bank_total = self._count_non_empty_lines(self.titles_file.get().strip())
        self._refresh_window_title()

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
        if self.image_list_file.get().strip():
            cmd.extend(["--image-list", self.image_list_file.get().strip()])
        if self.resume_existing.get():
            cmd.append("--resume")

        self.log_text.delete("1.0", "end")
        self._append_log("Starting batch render...\n")
        self._append_log(f"Render mode: multi-process analyze -> render with {concurrency} worker processes\n")
        self._append_log("Output mode: images go to the selected folder, JSON goes to an output\\json folder\n")
        self._append_log("Title bank formats: subfolder:title:code or subniche:niche|subniche:title:description|slug:imageId\n")
        self._append_log(f"Debug log: {DEBUG_LOG}\n")
        self._append_log(" ".join(cmd) + "\n\n")
        write_debug(f"\n=== START {now_timestamp()} ===")
        write_debug("COMMAND: " + " ".join(cmd))
        write_debug(f"IMAGES_DIR: {self.images_dir.get().strip()}")
        write_debug(f"TITLES_FILE: {self.titles_file.get().strip()}")
        write_debug(f"IMAGE_LIST_FILE: {self.image_list_file.get().strip()}")
        write_debug(f"OUTPUT_DIR: {self.output_dir.get().strip()}")
        self.status_text.set("Running")
        self.is_paused = False
        self.pause_button.configure(text="Pause", state="normal")
        self.progress.start(10)

        def worker():
            try:
                self.process = subprocess.Popen(
                    cmd,
                    cwd=str(ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                )
                for line in self.process.stdout:
                    write_debug(line.rstrip())
                    self.log_queue.put(line)
                code = self.process.wait()
                write_debug(f"EXIT_CODE: {code}")
                self.log_queue.put(f"\nFinished with exit code {code}\n")
                self.log_queue.put(("__DONE__", code))
            except FileNotFoundError:
                msg = "Could not find `node` on PATH."
                write_debug(msg)
                self.log_queue.put(msg + "\n")
                self.log_queue.put(("__DONE__", 1))
            except Exception as exc:
                write_debug("Desktop runner error: " + str(exc))
                write_debug(traceback.format_exc())
                self.log_queue.put(f"Desktop runner error: {exc}\n")
                self.log_queue.put(("__DONE__", 1))

        threading.Thread(target=worker, daemon=True).start()

    def stop_render(self):
        if self.process and self.process.poll() is None:
            if self.is_paused:
                self._resume_process_tree()
            self.process.terminate()
            self._append_log("\nStopping process...\n")

    def toggle_pause(self):
        if not self.process or self.process.poll() is not None:
            return

        if self.is_paused:
            self._resume_process_tree()
            self.is_paused = False
            self.pause_button.configure(text="Pause")
            self.status_text.set("Running")
            self.progress.start(10)
            self._append_log("\nResuming process...\n")
        else:
            self._pause_process_tree()
            self.is_paused = True
            self.pause_button.configure(text="Resume")
            self.status_text.set("Paused")
            self.progress.stop()
            self._append_log("\nPaused process...\n")

    def _pause_process_tree(self):
        self._send_process_tree_signal("suspend")

    def _resume_process_tree(self):
        self._send_process_tree_signal("resume")

    def _send_process_tree_signal(self, action):
        if not self.process or self.process.poll() is not None:
            return

        if platform.system().lower().startswith("win"):
            for pid in self._windows_process_tree_pids(self.process.pid, action):
                self._windows_suspend_resume_pid(pid, action)
            return

        sig = signal.SIGSTOP if action == "suspend" else signal.SIGCONT
        try:
            os.killpg(os.getpgid(self.process.pid), sig)
        except Exception:
            os.kill(self.process.pid, sig)

    def _windows_process_tree_pids(self, root_pid, action):
        try:
            output = subprocess.check_output(
                [
                    "powershell",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
                ],
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            records = json.loads(output or "[]")
        except Exception as exc:
            write_debug(f"Could not inspect process tree: {exc}")
            return [root_pid]

        if isinstance(records, dict):
            records = [records]

        children_by_parent = {}
        for record in records:
            try:
                parent = int(record.get("ParentProcessId"))
                child = int(record.get("ProcessId"))
            except (TypeError, ValueError):
                continue
            children_by_parent.setdefault(parent, []).append(child)

        ordered = []
        stack = [root_pid]
        seen = set()
        while stack:
            pid = stack.pop()
            if pid in seen:
                continue
            seen.add(pid)
            ordered.append(pid)
            stack.extend(children_by_parent.get(pid, []))
        return list(reversed(ordered)) if action == "suspend" else ordered

    def _windows_suspend_resume_pid(self, pid, action):
        try:
            import ctypes

            access = 0x0800
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
            handle = kernel32.OpenProcess(access, False, int(pid))
            if not handle:
                return
            try:
                if action == "suspend":
                    ntdll.NtSuspendProcess(handle)
                else:
                    ntdll.NtResumeProcess(handle)
            finally:
                kernel32.CloseHandle(handle)
        except Exception as exc:
            write_debug(f"Could not {action} pid {pid}: {exc}")

    def open_output_folder(self):
        output_path = self.output_dir.get().strip() or str(OUTPUT_DIR)
        os.makedirs(output_path, exist_ok=True)
        os.startfile(output_path)

    def _append_log(self, text):
        self.log_text.insert("end", text)
        self.log_text.see("end")
        write_debug(text)
        self._ingest_progress_text(text)

    def _drain_log_queue(self):
        try:
            while True:
                item = self.log_queue.get_nowait()
                if isinstance(item, tuple) and item[0] == "__DONE__":
                    self.progress.stop()
                    self.status_text.set("Done" if item[1] == 0 else "Failed")
                    self.is_paused = False
                    self.pause_button.configure(text="Pause", state="disabled")
                    self._refresh_window_title(finished=True)
                else:
                    self._append_log(item)
        except queue.Empty:
            pass
        self.root.after(120, self._drain_log_queue)

    def _reset_run_metrics(self):
        self.title_bank_total = 0
        self.last_completed_units = 0
        self.render_ms_total = 0
        self.render_ms_samples = 0

    def _count_non_empty_lines(self, file_path):
        if not file_path:
            return 0

        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
                return sum(1 for line in handle if line.strip())
        except Exception as exc:
            write_debug(f"Could not count titles in {file_path}: {exc}")
            return 0

    def _ingest_progress_text(self, text):
        if not text:
            return

        normalized = text.replace("\r", "\n")
        updated = False

        for match in PROGRESS_RE.finditer(normalized):
            rendered = int(match.group("rendered"))
            failed = int(match.group("failed"))
            skipped = int(match.group("skipped"))
            completed_units = rendered + failed + skipped

            extra = (match.group("extra") or "").strip()
            ms_match = MS_RE.search(extra)
            if ms_match and completed_units > self.last_completed_units:
                self.render_ms_total += int(ms_match.group(1))
                self.render_ms_samples += 1

            if completed_units != self.last_completed_units:
                self.last_completed_units = completed_units
                updated = True

        if updated:
            self._refresh_window_title()

    def _refresh_window_title(self, finished=False):
        if finished:
            self.root.title(APP_TITLE)
            self.log_title_text.set("Run Log")
            return

        if self.title_bank_total <= 0:
            self.root.title(APP_TITLE)
            self.log_title_text.set("Run Log")
            return

        remaining = max(0, self.title_bank_total - self.last_completed_units)
        title = "Run Log"

        if self.render_ms_samples > 0 and remaining > 0:
            avg_ms = self.render_ms_total / max(1, self.render_ms_samples)
            hours_left = (remaining * avg_ms) / 3600000
            title = f"{title} - {self._format_hours_left(hours_left)} remain"
        elif remaining > 0:
            title = f"{title} - calculating..."

        self.root.title(title)
        self.log_title_text.set(title)

    def _format_hours_left(self, hours_left):
        if hours_left >= 10:
            return f"{round(hours_left):.0f}hrs"
        if hours_left >= 1:
            rounded = round(hours_left, 1)
            if abs(rounded - round(rounded)) < 0.05:
                return f"{round(rounded):.0f}hrs"
            return f"{rounded:.1f}hrs"

        minutes_left = max(1, round(hours_left * 60))
        return f"{minutes_left}mins"

    def _log_environment(self):
        node_path = shutil.which("node")
        python_path = sys.executable
        details = [
            f"=== APP START {now_timestamp()} ===",
            f"ROOT: {ROOT}",
            f"PYTHON: {python_path}",
            f"NODE: {node_path or 'NOT FOUND'}",
            f"PLATFORM: {platform.platform()}",
            f"TK_VERSION: {tk.TkVersion}",
            f"DEBUG_LOG: {DEBUG_LOG}",
            f"SETTINGS_FILE: {SETTINGS_FILE}",
        ]
        for line in details:
            write_debug(line)
        self.log_queue.put("\n".join(details) + "\n\n")

    def _load_settings(self):
        if not SETTINGS_FILE.exists():
            return

        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            write_debug(f"Could not load settings: {exc}")
            return

        self.images_dir.set(data.get("images_dir", self.images_dir.get()))
        self.titles_file.set(data.get("titles_file", self.titles_file.get()))
        self.image_list_file.set(data.get("image_list_file", self.image_list_file.get()))
        self.output_dir.set(data.get("output_dir", self.output_dir.get()))
        self.template_mode.set(data.get("template_mode", self.template_mode.get()))
        self.pin_size.set(data.get("pin_size", self.pin_size.get()))
        self.output_format.set(data.get("output_format", self.output_format.get()))
        self.quality.set(data.get("quality", self.quality.get()))
        self.variants.set(data.get("variants", self.variants.get()))
        self.concurrency.set(data.get("concurrency", self.concurrency.get()))
        self.resume_existing.set(data.get("resume_existing", self.resume_existing.get()))

    def _save_settings(self):
        data = {
            "images_dir": self.images_dir.get().strip(),
            "titles_file": self.titles_file.get().strip(),
            "image_list_file": self.image_list_file.get().strip(),
            "output_dir": self.output_dir.get().strip(),
            "template_mode": self.template_mode.get().strip(),
            "pin_size": self.pin_size.get().strip(),
            "output_format": self.output_format.get().strip(),
            "quality": self.quality.get().strip(),
            "variants": self.variants.get().strip(),
            "concurrency": self.concurrency.get().strip(),
            "resume_existing": self.resume_existing.get(),
        }

        try:
            SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as exc:
            write_debug(f"Could not save settings: {exc}")

    def _on_close(self):
        if self.process and self.process.poll() is None:
            if not messagebox.askyesno("Quit", "A render is still running. Stop it and quit?"):
                return
            if self.is_paused:
                self._resume_process_tree()
            self.process.terminate()
        self._save_settings()
        self.root.destroy()


def main():
    try:
        write_debug(f"\n=== MAIN {now_timestamp()} ===")
        app = tk.Tk()
        PinFactoryDesktop(app)
        app.mainloop()
    except Exception as exc:
        write_debug("Fatal desktop app error: " + str(exc))
        write_debug(traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
