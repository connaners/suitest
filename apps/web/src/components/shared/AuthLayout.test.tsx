import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AuthContainer,
  AuthFooter,
  AuthHeader,
  AuthSubmitButton,
} from "@/components/shared/AuthLayout";

describe("AuthLayout components", () => {
  it("renders AuthHeader with logo, title, and subtitle", () => {
    render(<AuthHeader subtitle="Please enter your email" />);
    expect(screen.getByAltText("Suitest")).toBeInTheDocument();
    expect(screen.getByText("Please enter your email")).toBeInTheDocument();
  });

  it("renders AuthSubmitButton in idle and submitting states", () => {
    const { rerender } = render(
      <AuthSubmitButton submitting={false} label="Send link" loadingLabel="Sending…" />,
    );
    const button = screen.getByRole("button", { name: "Send link" });
    expect(button).toBeEnabled();

    rerender(
      <AuthSubmitButton submitting={true} label="Send link" loadingLabel="Sending…" />,
    );
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  });

  it("renders AuthFooter with copyright text", () => {
    render(<AuthFooter />);
    expect(screen.getByText(/© 2026 Suitest contributors/i)).toBeInTheDocument();
  });

  it("renders AuthContainer wrapping children", () => {
    render(
      <AuthContainer>
        <div data-testid="child-content">Child</div>
      </AuthContainer>,
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });
});
