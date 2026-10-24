import { useState } from "react";
import type { ActionResult, ActionState, Loadable, SessionConfig } from "../types";
import type { ScreenContext } from "../ui-contract";
import { ActionFeedback } from "../components/Feedback";
import { Button, Panel, SectionHeader } from "../components/ui";
import { DemoModeSwitch } from "../demo/DemoDock";

/*
 * S1's own screen (the contract names the "setup" route but assigns it to no agent).
 * Claiming the organiser role is an explicit action. Joining the app never claims it, and
 * replacing an existing organiser is a separate, confirmed step. This is a workflow
 * convention for the demo, not access control: anyone who can edit the shared files can
 * change data/session.json.
 */

export interface SetupProps extends ScreenContext {
  session: Loadable<SessionConfig>;
  /** Display name of the current organiser, when known. */
  organiserName: string | null;
  claimState: ActionState;
  /** Absent in preview and when signed out. */
  onClaim?: (replace: boolean) => Promise<ActionResult<unknown>>;
}

export function Setup({ mode, currentUser, session, organiserName, claimState, onClaim, onNavigate }: SetupProps) {
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  if (mode === "preview") {
    return (
      <div className="myt-stack">
        <SectionHeader level={1} eyebrow="Setup" title="Choose the organiser" />
        <div className="myt-banner" data-tone="warn">
          <div className="myt-banner__text">Setup is not available in preview. Leave preview to choose an organiser.</div>
        </div>
      </div>
    );
  }

  const organiserId = session.state === "ready" ? session.value.organiserUserId : null;
  const iAmOrganiser = currentUser !== null && organiserId !== null && organiserId === currentUser.id;
  const pending = claimState.status === "pending";

  const claim = async (replace: boolean) => {
    if (!onClaim) return;
    const result = await onClaim(replace);
    if (result.ok) setConfirmingReplace(false);
  };

  return (
    <div className="myt-stack">
      <SectionHeader
        level={1}
        eyebrow="Setup"
        title="Choose the organiser"
        description="One person confirms the final time and meeting point for the group. Choose them before you rehearse together."
      />

      {session.state === "loading" ? <p role="status" className="myt-muted">Loading setup…</p> : null}

      {session.state === "error" ? (
        <div className="myt-banner" data-tone="danger" role="alert">
          <div className="myt-banner__text">
            <strong className="myt-banner__title">Setup could not be read.</strong> {session.error.message}
          </div>
        </div>
      ) : null}

      {session.state === "ready" ? (
        <Panel title="Organiser">
          {organiserId === null ? (
            <p>Nobody is the organiser yet, so nobody can confirm a plan.</p>
          ) : iAmOrganiser ? (
            <p>
              <strong>You are the organiser.</strong> You can confirm a plan once at least two real people, including you, have said they would go.
            </p>
          ) : (
            <p>
              The organiser is <strong>{organiserName ?? "another student"}</strong>. Only they see the confirm controls.
            </p>
          )}

          <p className="myt-muted myt-small">
            This is an agreement between people using the app, not a permission. Anyone who can edit the shared files could change it.
          </p>

          {!currentUser ? (
            <p className="myt-muted">Sign in to choose an organiser.</p>
          ) : !onClaim ? (
            <p className="myt-muted">Saving is not available right now.</p>
          ) : organiserId === null ? (
            <div className="myt-actions">
              <Button variant="primary" pending={pending} onClick={() => void claim(false)}>
                Set me as organiser
              </Button>
            </div>
          ) : iAmOrganiser ? null : confirmingReplace ? (
            <div className="myt-stack myt-stack--sm">
              <div className="myt-banner" data-tone="warn" role="alert">
                <div className="myt-banner__text">
                  <strong className="myt-banner__title">Replace {organiserName ?? "the organiser"}?</strong> Do this only if your group has agreed.
                  They will lose the confirm controls.
                </div>
              </div>
              <div className="myt-actions">
                <Button variant="danger" pending={pending} onClick={() => void claim(true)}>
                  Yes, make me the organiser
                </Button>
                <Button variant="quiet" disabled={pending} onClick={() => setConfirmingReplace(false)}>
                  Keep {organiserName ?? "them"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="myt-actions">
              <Button variant="quiet" onClick={() => setConfirmingReplace(true)}>
                Replace organiser…
              </Button>
            </div>
          )}

          <ActionFeedback
            state={claimState}
            mode={mode}
            successMessage="Saved on this device. Others will see the change after it syncs."
          />
        </Panel>
      ) : null}

      <Panel title="Presenting alone">
        <DemoModeSwitch />
      </Panel>

      <div className="myt-actions">
        <Button variant="quiet" onClick={() => onNavigate({ name: "discover" })}>
          Back to activities
        </Button>
      </div>
    </div>
  );
}
