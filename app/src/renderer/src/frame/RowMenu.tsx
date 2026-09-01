// The menu you get by right-clicking a row in the sidebar.
//
// **In the DOM, not `Menu.popup`.** Electron's native menu is the right answer
// for the menu BAR, which belongs to the machine and has to look like every
// other application's; a menu that opens on a row is part of this panel, and
// one drawn by the OS would arrive in the OS's colours in the middle of a theme
// somebody chose. It is also a round trip to main and back for a list main does
// not otherwise need to know.
//
// The same shape as `Prompt` and `Confirm`, for the same reason they exist.

import { useEffect, useRef } from 'react'

export interface MenuItem {
  readonly label: string
  /** Coloured as such, and never the first item: the pointer starts at the top. */
  readonly destructive?: boolean
  readonly onChoose: () => void
}

/** A rule between groups of items. A string, so a list can be written inline. */
export type MenuEntry = MenuItem | 'rule'

export interface RowMenuRequest {
  /** Where the pointer was. The menu opens there, the way every menu does. */
  readonly at: { readonly x: number; readonly y: number }
  /** What the menu is about, read out for anybody not looking at the row. */
  readonly about: string
  readonly items: readonly MenuEntry[]
}

/**
 * **Fixed, and clamped to the window.** The panel scrolls and clips; a menu
 * placed inside that flow would be cut off by the row below it, and one opened
 * near the bottom edge would run off the screen. Both are the same fix: take it
 * out of the flow and put it where it fits.
 */
export function RowMenu({
  request,
  onClose,
}: {
  request: RowMenuRequest
  onClose: () => void
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null)

  // Focus moves INTO the menu, which is what makes Escape and the arrow keys
  // reach it — and what makes a click anywhere else close it, since a blur is
  // the same event as clicking away.
  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
  }, [])

  useEffect(() => {
    const node = menu.current
    if (node === null) return
    // Placed after paint, when its own height is known: a menu near the bottom
    // of the window has to know how tall it is before it can decide it does not
    // fit there.
    const box = node.getBoundingClientRect()
    const margin = 8
    node.style.left = `${Math.max(margin, Math.min(request.at.x, window.innerWidth - box.width - margin))}px`
    node.style.top = `${Math.max(margin, Math.min(request.at.y, window.innerHeight - box.height - margin))}px`
  }, [request])

  return (
    <div
      className="row-menu-scrim"
      onMouseDown={onClose}
      onContextMenu={e => {
        // A second right-click moves the menu rather than opening the OS's on
        // top of this one.
        e.preventDefault()
        onClose()
      }}
    >
      <div
        className="row-menu"
        role="menu"
        aria-label={request.about}
        ref={menu}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            return
          }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          const buttons = [...(menu.current?.querySelectorAll('button') ?? [])]
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }}
      >
        {request.items.map((item, i) =>
          item === 'rule' ? (
            <hr key={`rule:${i}`} />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.destructive === true ? 'destructive' : ''}
              onClick={() => {
                onClose()
                item.onChoose()
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
