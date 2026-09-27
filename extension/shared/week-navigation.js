(function registerWeekNavigation(scope) {
  const RANGE_PATTERN =
    /\b\d{1,2}\s*[-–—]\s*\d{1,2}\s+[а-яё]+(?:\s+20\d{2})?\b/i;
  const CLICKABLE_SELECTOR =
    'button, [role="button"], a[href], input[type="button"], input[type="submit"]';
  const DIRECTION_PATTERNS = Object.freeze({
    previous:
      /предыдущ|назад|previous|prev|chevron[_-]?(?:left|back)|arrow[_-]?(?:left|back)|angle[_-]?left|keyboard_arrow_left|navigate_before|arrow_back_ios/i,
    next: /следующ|впер[её]д|next|chevron[_-]?(?:right|forward)|arrow[_-]?(?:right|forward)|angle[_-]?right|keyboard_arrow_right|navigate_next|arrow_forward_ios/i,
  });
  const CALENDAR_PATTERN = /calendar|календар|date_range|event/i;

  function findWeekButtons(
    documentRef,
    direction,
    getStyle = (element) => scope.getComputedStyle(element),
  ) {
    const rangeElement = findRangeElement(documentRef);
    const candidates = getClickableElements(documentRef).filter((element) =>
      isUsableButton(element, getStyle),
    );
    const ranked = [];

    candidates.forEach((element, order) => {
      const description = describeButton(element);
      if (!DIRECTION_PATTERNS[direction].test(description)) return;
      ranked.push({
        element,
        order,
        score:
          1_000 +
          (/недел|week/i.test(description) ? 250 : 0) +
          (element.getAttribute("aria-label") || element.getAttribute("title")
            ? 50
            : 0) +
          getProximityScore(element, rangeElement),
      });
    });

    getLocalFallbacks(rangeElement, candidates, direction).forEach(
      (element, order) => {
        ranked.push({
          element,
          order: candidates.indexOf(element),
          score: 500 - order + getProximityScore(element, rangeElement),
        });
      },
    );

    return ranked
      .sort(
        (first, second) =>
          second.score - first.score || first.order - second.order,
      )
      .map((item) => item.element)
      .filter((element, index, values) => values.indexOf(element) === index);
  }

  function findWeekButton(documentRef, direction, getStyle) {
    return findWeekButtons(documentRef, direction, getStyle)[0];
  }

  function findRangeElement(documentRef) {
    return [...documentRef.querySelectorAll("body *")]
      .filter((element) => RANGE_PATTERN.test(element.textContent || ""))
      .sort(
        (first, second) =>
          String(first.textContent || "").length -
          String(second.textContent || "").length,
      )[0];
  }

  function getClickableElements(documentRef) {
    const elements = [...documentRef.querySelectorAll(CLICKABLE_SELECTOR)];
    documentRef.querySelectorAll("mat-icon, i, svg, use").forEach((icon) => {
      const clickable = icon.closest(CLICKABLE_SELECTOR);
      if (clickable && !elements.includes(clickable)) elements.push(clickable);
    });
    return elements;
  }

  function getLocalFallbacks(rangeElement, candidates, direction) {
    if (!rangeElement) return [];
    const groups = [];
    let container = rangeElement.parentElement;
    for (let depth = 0; container && depth < 14; depth += 1) {
      const local = candidates.filter((element) => container.contains(element));
      if (local.length >= 2 && local.length <= 8) groups.push(local);
      container = container.parentElement;
    }

    const rangeRect = getRect(rangeElement);
    if (hasPosition(rangeRect)) {
      const nearby = candidates.filter((element) => {
        const rect = getRect(element);
        if (!hasPosition(rect)) return false;
        const verticalDistance = Math.abs(centerY(rect) - centerY(rangeRect));
        const horizontalDistance = Math.abs(centerX(rect) - centerX(rangeRect));
        return verticalDistance <= 180 && horizontalDistance <= 900;
      });
      if (nearby.length >= 2 && nearby.length <= 10) groups.unshift(nearby);
    }

    const fallbacks = [];
    groups.forEach((group) => {
      const navigation = group.filter(
        (element) => !CALENDAR_PATTERN.test(describeButton(element)),
      );
      if (navigation.length < 2) return;
      navigation.sort((first, second) => {
        const firstRect = getRect(first);
        const secondRect = getRect(second);
        if (hasPosition(firstRect) && hasPosition(secondRect)) {
          return firstRect.left - secondRect.left;
        }
        return candidates.indexOf(first) - candidates.indexOf(second);
      });
      const target =
        direction === "previous"
          ? navigation[navigation.length - 2]
          : navigation[navigation.length - 1];
      if (target && !fallbacks.includes(target)) fallbacks.push(target);
    });
    return fallbacks;
  }

  function describeButton(element) {
    return [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("class"),
      element.getAttribute("id"),
      element.innerHTML,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function getProximityScore(element, rangeElement) {
    if (!rangeElement) return 0;
    if (rangeElement.parentElement?.contains(element)) return 300;
    const rangeRect = getRect(rangeElement);
    const elementRect = getRect(element);
    if (!hasPosition(rangeRect) || !hasPosition(elementRect)) return 0;
    const distance =
      Math.abs(centerY(elementRect) - centerY(rangeRect)) * 2 +
      Math.abs(centerX(elementRect) - centerX(rangeRect));
    return Math.max(0, 280 - distance / 4);
  }

  function getRect(element) {
    return element?.getBoundingClientRect?.() || {};
  }

  function hasPosition(rect) {
    return Boolean(rect.width || rect.height || rect.left || rect.top);
  }

  function centerX(rect) {
    return Number(rect.left || 0) + Number(rect.width || 0) / 2;
  }

  function centerY(rect) {
    return Number(rect.top || 0) + Number(rect.height || 0) / 2;
  }

  function isUsableButton(element, getStyle) {
    if (element.disabled || element.hidden) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    const style = getStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  scope.SchoolppWeekNavigation = Object.freeze({
    findRangeElement,
    findWeekButton,
    findWeekButtons,
  });
})(globalThis);
