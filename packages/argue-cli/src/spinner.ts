const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

export type SpinnerStream = {
  write(chunk: string): boolean | void;
  isTTY?: boolean;
};

export type SpinnerOptions = {
  intervalMs?: number;
  isTTY?: boolean;
  noColor?: boolean;
};

export type Spinner = {
  start(label?: string): void;
  stop(finalLine?: string): void;
  setLabel(next: string): void;
  isActive(): boolean;
};

export function createSpinner(stream: SpinnerStream, label: string, options: SpinnerOptions = {}): Spinner {
  const isTTY = options.isTTY ?? stream.isTTY ?? false;
  const useColor = !options.noColor && !process.env.NO_COLOR && isTTY;
  const intervalMs = options.intervalMs ?? 80;

  let currentLabel = label;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let active = false;
  let lastBreadcrumb: string | null = null;

  const dim = useColor ? "\x1b[2m" : "";
  const cyan = useColor ? "\x1b[36m" : "";
  const reset = useColor ? "\x1b[0m" : "";

  function render(): void {
    const glyph = BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length];
    stream.write(`\r${cyan}${glyph}${reset} ${dim}${currentLabel}${reset}\x1b[K`);
    frame += 1;
  }

  return {
    start(nextLabel?: string): void {
      if (nextLabel !== undefined) currentLabel = nextLabel;
      if (active) return;
      active = true;
      if (!isTTY) {
        // No animation in non-TTY contexts (logs, CI). Still emit one line so
        // there is a visible breadcrumb that the command is running — but only
        // when the label actually changed. Without this guard, every stop/start
        // cycle (one per engine event) stacks another identical line in the log.
        if (currentLabel !== lastBreadcrumb) {
          stream.write(`${currentLabel}\n`);
          lastBreadcrumb = currentLabel;
        }
        return;
      }
      stream.write("\x1b[?25l");
      render();
      timer = setInterval(render, intervalMs);
    },
    stop(finalLine?: string): void {
      if (!active) return;
      active = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTTY) {
        stream.write("\r\x1b[K\x1b[?25h");
      }
      if (finalLine) {
        stream.write(`${finalLine}\n`);
      }
    },
    setLabel(next: string): void {
      currentLabel = next;
    },
    isActive(): boolean {
      return active;
    }
  };
}
