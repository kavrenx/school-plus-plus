(function registerESchoolsParser(scope) {
  function collectPage(documentRef, locationRef, now = new Date()) {
    const title = cleanText(
      documentRef.querySelector("h1, h2, [class*='title']")?.textContent ||
        documentRef.title,
    );
    const tables = [...documentRef.querySelectorAll("table")]
      .map(parseTable)
      .filter((table) => table.rows.length);
    const headings = [...documentRef.querySelectorAll("h1, h2, h3")]
      .map((element) => cleanText(element.textContent))
      .filter(Boolean)
      .slice(0, 30);
    const capturedAt = now.toISOString();
    const route = `${locationRef.pathname || "/"}${locationRef.hash || ""}`;
    return {
      key: route || "/",
      url: `${locationRef.origin || ""}${route}`,
      route,
      title,
      kind: detectPageKind(`${title} ${route} ${headings.join(" ")}`),
      capturedAt,
      profile: collectProfile(documentRef),
      studentIdentity: collectStudentIdentity(documentRef),
      classTeacher: collectClassTeacher(documentRef),
      headings,
      tables,
    };
  }

  function parseTable(table) {
    const caption = cleanText(
      table.caption?.textContent ||
        table.previousElementSibling?.textContent ||
        table.closest("section, article, div")?.querySelector("h2, h3")
          ?.textContent ||
        "",
    );
    const rows = [...table.querySelectorAll("tr")]
      .map((row) =>
        [...row.querySelectorAll(":scope > th, :scope > td")]
          .map((cell) => cleanText(cell.textContent))
          .filter(Boolean),
      )
      .filter((row) => row.length);
    const headerCells = [
      ...table.querySelectorAll("thead th, tr:first-child th"),
    ];
    const headers = [...new Set(headerCells)]
      .map((cell) => cleanText(cell.textContent))
      .filter(Boolean);
    return { caption, headers, rows };
  }

  function collectProfile(documentRef) {
    const candidates = [
      ...documentRef.querySelectorAll(
        "header [class*='user'], header [class*='profile'], header [class*='account']",
      ),
    ]
      .map((element) => cleanText(element.textContent))
      .filter((value) => value && value.length <= 160);
    return candidates.length ? { label: candidates[0] } : null;
  }

  function collectStudentIdentity(documentRef) {
    const match = findInPageText(
      documentRef,
      /электронный дневник обучающегося\s+(\d+\s*[«"']?[А-ЯЁІЎA-Z]{1,3}[»"']?)\s+класса,\s*([А-ЯЁІЎA-Z][А-Яа-яЁёІіЎўA-Za-z'-]+(?:\s+(?:(?:[А-ЯЁІЎA-Z]\.){1,3}|[А-ЯЁІЎA-Z][а-яёіўa-z'-]+(?:\s+[А-ЯЁІЎA-Z][а-яёіўa-z'-]+)?)))/iu,
    );
    return match ? { classTitle: match[1], name: match[2] } : null;
  }

  function collectClassTeacher(documentRef) {
    const label = /классн(?:ый|ого)\s+руководител(?:ь|я)/iu;
    const candidates = [...documentRef.querySelectorAll("body *")]
      .map((element) => cleanText(element.innerText || element.textContent))
      .filter((value) => value && value.length <= 140 && label.test(value))
      .sort((first, second) => first.length - second.length);
    const pattern =
      /^классн(?:ый|ого)\s+руководител(?:ь|я)\s*:?\s*([А-ЯЁІЎA-Z][А-Яа-яЁёІіЎўA-Za-z'-]+(?:\s+(?:(?:[А-ЯЁІЎA-Z]\.){1,3}|[А-ЯЁІЎA-Z][а-яёіўa-z'-]+\s+[А-ЯЁІЎA-Z][а-яёіўa-z'-]+)))\s*$/iu;
    for (const text of candidates) {
      const match = text.match(pattern);
      if (match && isLikelyPersonName(match[1])) return match[1];
    }
    return "";
  }

  function isLikelyPersonName(value) {
    const text = cleanText(value);
    if (
      /(?:сообщени|четверг|пятниц|суббот|воскресен|понедельник|вторник|среда)/iu.test(
        text,
      )
    )
      return false;
    return /(?:\b(?:[А-ЯЁІЎA-Z]\.){1,3}$)|(?:^[^\s]+\s+[^\s]+\s+[^\s]+$)/u.test(
      text,
    );
  }

  function findInPageText(documentRef, pattern) {
    const candidates = [
      ...documentRef.querySelectorAll(
        "h1, h2, h3, h4, [class*='title'], [class*='diary'], [class*='profile']",
      ),
    ]
      .map((element) => cleanText(element.innerText || element.textContent))
      .filter(Boolean)
      .sort((first, second) => first.length - second.length);
    const pageText = cleanText(
      documentRef.body?.innerText || documentRef.body?.textContent,
    );
    if (pageText) candidates.push(pageText);
    for (const text of candidates) {
      const match = text.match(pattern);
      if (match) return match;
    }
    return null;
  }

  function detectPageKind(value) {
    const text = value.toLocaleLowerCase("ru");
    if (text.includes("звон")) return "bells";
    if (text.includes("каникул")) return "holidays";
    if (text.includes("предмет")) return "subjects";
    if (text.includes("итог") || text.includes("успева")) return "results";
    if (text.includes("расписан")) return "schedule";
    if (text.includes("дневник")) return "diary";
    return "unknown";
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  scope.SchoolppEschoolParser = Object.freeze({
    cleanText,
    collectClassTeacher,
    collectPage,
    collectStudentIdentity,
    detectPageKind,
    parseTable,
  });
})(globalThis);
