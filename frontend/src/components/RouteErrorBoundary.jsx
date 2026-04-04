import { RefreshCcw } from "lucide-react";
import { Component } from "react";

import { captureClientError } from "../observability.js";

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("RouteErrorBoundary captured an error", error, info);
    captureClientError(error, { componentStack: info?.componentStack || "" });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-black px-4">
          <div className="w-full max-w-lg rounded-[24px] border border-x-border bg-[#111214] p-8 text-center">
            <p className="text-[28px] font-extrabold text-x-primary">Something went wrong</p>
            <p className="mt-3 text-[15px] leading-6 text-x-secondary">
              This screen ran into an unexpected problem. Reload to try again.
            </p>
            <button
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[15px] font-bold text-black transition hover:bg-white/90"
              onClick={this.handleReload}
              type="button"
            >
              <RefreshCcw className="h-4 w-4" />
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
