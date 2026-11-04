/**
 * A plan card's frame, drawn behind its rows (the four cards and Own key's):
 * the current plan's blue ring and tint (app/styles/ui.css,
 * .lv-selected-frame: the colour of its "Your plan" badge), else a white
 * card with a light edge. The ring lies inside the card, so the cards'
 * edges line up.
 */
export function CardBack({ current }: { current: boolean }) {
  return (
    <div aria-hidden="true" className="lv-plan-card__back">
      <div className={current ? "lv-selected-frame" : "lv-plan-frame"} />
    </div>
  );
}
