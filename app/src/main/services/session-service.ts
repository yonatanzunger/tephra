// **Domain. Depends on `CorpusService`, `DayService` and `Bus`.**
//
// What this session knows about the notebook that is not its content: which day
// it is filing into, where the machine says it is, and where the reader left
// the panes.
//
// **Why these three are one service.** Each is asked on the way in — the app
// opens, restores its panes, and needs to know what day it is and whether the
// zone is still right — and each is *per notebook rather than per window*: three
// windows asking the same question must get the same answer, which is exactly
// the defect the zone offer exists to fix (D63). Neither is content, so neither
// is in the corpus: the zone is a notebook setting and the pane state is local
// to this machine.
//
// **The upward edge, inverted.** Every day-check has to re-offer the zone, and
// the offer is session state that lives above the day service — so the day
// service announces and this subscribes (D83). One of the four places that
// inversion is what makes the DAG acyclic.

import type { CorpusService } from './corpus-service.ts'
import type { DayService } from './day-service.ts'
import type { Bus } from './bus.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL, type ZoneNotice } from '../../shared/ipc.ts'
import type { DateKey } from '../../shared/document-api.ts'
import { isKnownZone } from '../../shared/dates.ts'
import { parseUiState, type UiState } from '../../shared/ui-state.ts'
import { LOCAL } from '../w/layout.ts'
import { systemZone } from '../system-zone.ts'

export interface SessionOptions {
  /**
   * Where this machine says it is. Injected for the same reason the clock is: a
   * test cannot change the operating system's timezone, and the interesting
   * cases are all about that answer changing under a running app.
   */
  readonly systemZone?: () => string
}

export class SessionService implements Serves {
  readonly #store: CorpusService
  readonly #day: DayService
  readonly #bus: Bus

  constructor(store: CorpusService, day: DayService, bus: Bus, options: SessionOptions = {}) {
    this.#store = store
    this.#day = day
    this.#bus = bus
    this.#systemZone = options.systemZone ?? systemZone
    // **Subscribed here rather than pushed from there.** The day service has no
    // business knowing that anybody cares about the zone; it says *I checked*,
    // and what that implies is the subscriber's (D83).
    this.#day.onChecked(() => this.#tellAboutTheZone())
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.loadUiState, () => this.loadUiState()),
      serve(CHANNEL.saveUiState, (state: UiState) => this.saveUiState(state)),
      // **What day the app is filing into** (D62). A read of the day service,
      // which owns no channels of its own — the foundation has no isomorph on
      // the far side of the fence, so the service that presents the day to a
      // renderer is the one that owns the question of what it means (D83).
      serve(CHANNEL.today, () => this.today),
      serve(CHANNEL.setZone, (zone: string) => this.setZone(zone)),
      serve(CHANNEL.zoneNotice, () => this.askZoneNotice()),
      serve(CHANNEL.dismissZone, () => this.dismissZone()),
    ]
  }

  /** What day the app is filing into — the day service's (D62, D83). */
  get today(): DateKey {
    return this.#day.today
  }

  /**
   * A system zone somebody has already declined to adopt.
   *
   * Held by main rather than by a window, so dismissing the offer in one window
   * dismisses it everywhere — three windows each asking the same question is
   * the same defect as three windows asking different ones.
   */
  #declined: string | null = null
  /**
   * The last zone notice anybody was told about, so a poll does not repeat it.
   *
   * **`undefined` is "nobody has been told anything", and null is "told there
   * is nothing to say"** — two different states, and collapsing them cost the
   * first bug this found: a window that got its notice from the opening
   * question rather than from a push left this at its initial value, so
   * adopting the zone computed the same value, decided nothing had changed, and
   * never told the window to put the row away.
   */
  #offered: string | null | undefined = undefined
  readonly #systemZone: () => string

  // ── where the reader was ───────────────────────────────────

  async loadUiState(): Promise<UiState> {
    return parseUiState(await this.#store.notebook.read(LOCAL.uiState))
  }

  /**
   * Written straight through rather than queued behind edits: losing a cursor
   * position is cheap and self-correcting, and making it wait behind the write
   * tiers would spend a real guarantee on a soft one.
   */
  async saveUiState(state: UiState): Promise<void> {
    await this.#store.notebook.write(LOCAL.uiState, JSON.stringify(state, null, 2) + '\n')
  }

  /** Say where you are now, and keep it with the notebook (D63). */
  async setZone(zone: string): Promise<void> {
    await this.#day.setZone(zone)
    // A zone somebody chose is not a zone somebody declined.
    this.#declined = null
    this.#tellAboutTheZone()
  }

  /**
   * What to say about the zone, if anything (D63).
   *
   * **Main answers this, not a window.** The zone is offered and never applied,
   * and the offer is only useful if it is the same offer everywhere: two
   * windows each resolving the system zone in their own process got two
   * answers — a renderer's `Intl` is fixed when its context is created — and
   * sat side by side proposing to move the notebook in opposite directions.
   *
   * Null while they agree, while the machine's zone is one this build cannot
   * compute in, and while somebody has already said no to this one.
   */
  get zoneNotice(): ZoneNotice | null {
    const system = this.#systemZone()
    if (system === this.#day.zone || system === this.#declined || !isKnownZone(system)) return null
    return { notebook: this.#day.zone, system }
  }

  /**
   * No thanks — travelling, or the machine is wrong, and either way the
   * notebook stays where it is. Silent until the machine moves somewhere new.
   */
  dismissZone(): void {
    this.#declined = this.#systemZone()
    this.#tellAboutTheZone()
  }

  /**
   * The same answer, for a window that is asking on its way in.
   *
   * **Asking reconciles.** A window opening between two polls is the one moment
   * main is asked a question it has not yet had a reason to ask itself, and the
   * answer has to reach the OTHER windows too — otherwise the window that asked
   * is the only one that is right, which is the entire defect this exists to
   * fix, rebuilt out of new parts.
   */
  askZoneNotice(): ZoneNotice | null {
    this.#tellAboutTheZone()
    return this.zoneNotice
  }

  /**
   * Push the notice when it has changed, from wherever noticed it.
   *
   * Every window is told the same thing at the same time, which is the property
   * that was missing. Repeating an unchanged notice on every poll would be
   * harmless and is still not done: a window that redraws itself twice a minute
   * for no reason is a window somebody will eventually have to debug.
   */
  #tellAboutTheZone(): void {
    const notice = this.zoneNotice
    const key = notice === null ? null : `${notice.notebook} ${notice.system}`
    if (key === this.#offered) return
    this.#offered = key
    this.#bus.announce(CHANNEL.zoneNotice, notice)
  }
}
