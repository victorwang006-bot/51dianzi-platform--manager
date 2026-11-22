import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKeys?: readonly unknown[];
  onBack?: () => void;
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Retain diagnostics without exposing a full stack in the normal page UI.
    console.error("[AdminErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    const before = previous.resetKeys ?? [];
    const after = this.props.resetKeys ?? [];
    if (this.state.hasError && (before.length !== after.length ||
      after.some((key, index) => !Object.is(key, before[index])))) {
      this.reset();
    }
  }

  private reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div role="alert" className={cn(
        "flex items-center justify-center p-8 bg-background",
        this.props.compact ? "min-h-64" : "min-h-screen"
      )}>
        <div className="flex flex-col items-center w-full max-w-2xl p-8">
          <AlertTriangle size={48} className="text-destructive mb-6 flex-shrink-0" />
          <h2 className="text-xl mb-4">页面暂时无法显示</h2>
          <p className="text-sm text-muted-foreground mb-6">请重试，或返回其他页面继续操作。</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={this.reset} className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg",
              "bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
            )}>
              <RotateCcw size={16} />重试
            </button>
            {this.props.onBack ? (
              <button type="button" onClick={this.props.onBack} className="px-4 py-2 rounded-lg border hover:bg-muted">返回其他页面</button>
            ) : (
              <a href={import.meta.env.BASE_URL} className="px-4 py-2 rounded-lg border hover:bg-muted">返回后台首页</a>
            )}
          </div>
          <details className="mt-6 w-full text-sm text-muted-foreground">
            <summary className="cursor-pointer">查看错误详情</summary>
            <pre className="p-4 rounded bg-muted overflow-auto whitespace-break-spaces">{this.state.error?.stack ?? this.state.error?.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
