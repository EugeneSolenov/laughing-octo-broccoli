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
        <div className="auth-shell">
          <div className="m3-panel" style={{ width: "min(520px, 100%)", padding: 28, textAlign: "center" }}>
            <p className="m3-section-label">Неожиданная ошибка</p>
            <p className="m3-title-medium" data-display="true" style={{ marginTop: 8, fontSize: 28 }}>
              Что-то пошло не так
            </p>
            <p className="m3-body-small" style={{ marginTop: 10 }}>
              На этом экране произошла ошибка. Перезагрузите страницу и попробуйте снова.
            </p>
            <button className="m3-button m3-button-filled m3-fab m3-interactive" onClick={this.handleReload} style={{ marginTop: 20 }} type="button">
              <RefreshCcw size={16} />
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
