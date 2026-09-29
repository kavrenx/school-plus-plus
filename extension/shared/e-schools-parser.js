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
    const kind = detectPageKind(`${title} ${route} ${headings.join(" ")}`);
    const weekDate = kind === "diary" ? findFirstTableDate(tables) : "";
    const lessonMaterialRows =
      kind === "diary" ? collectLessonMaterialRows(documentRef) : [];
    return {
      key: weekDate ? `${route || "/"}::week:${weekDate}` : route || "/",
      url: `${locationRef.origin || ""}${route}`,
      route,
      title,
      kind,
      weekDate,
      capturedAt,
      profile: collectProfile(documentRef),
      studentIdentity: collectStudentIdentity(documentRef),
      classTeacher: collectClassTeacher(documentRef),
      headings,
      tables,
      lessonMaterials: lessonMaterialRows
        .filter((row) => row.attachments.length)
        .map(({ candidates: _candidates, ...row }) => row),
      materialHints: lessonMaterialRows
        .filter((row) => row.candidates.length)
        .map((row) => ({
          date: row.date,
          number: row.number,
          startTime: row.startTime,
          subject: row.subject,
          candidates: row.candidates,
        })),
    };
  }

  function collectLessonMaterialRows(documentRef) {
    return [...documentRef.querySelectorAll("table")].flatMap((table) => {
      const date = findElementDate(table);
      return [...table.querySelectorAll("tr")]
        .map((row) => collectLessonMaterialRow(row, date))
        .filter(Boolean);
    });
  }

  function collectVisibleMaterials(documentRef) {
    return uniqueMaterials(
      [...documentRef.querySelectorAll("a[href]")]
        .filter((element) => isVisibleElement(element))
        .map(materialFromElement)
        .filter(Boolean),
    );
  }

  function collectApiMaterials(value) {
    const result = [];
    const metadata = new Map();
    const unnamedTitles = [];
    visit(value, {}, 0);
    const knownMetadata = [...metadata.values()];
    const enriched = result.map((item) => ({
      ...item,
      title:
        item.title ||
        metadata.get(item.id)?.title ||
        (result.length === 1 && unnamedTitles.length === 1
          ? unnamedTitles[0]
          : "") ||
        inferApiMaterialName(item.url),
    }));
    knownMetadata.forEach((item) => {
      if (
        !enriched.some(
          (material) =>
            (item.id && material.id === item.id) ||
            (item.title && material.title === item.title),
        )
      )
        enriched.push({ url: "", title: item.title, id: item.id });
    });
    if (!enriched.length && unnamedTitles.length === 1)
      enriched.push({ url: "", title: unnamedTitles[0], id: "" });
    return uniqueMaterials(enriched);

    function visit(item, inherited, depth) {
      if (item == null || depth > 12) return;
      if (Array.isArray(item)) {
        item.forEach((entry) => visit(entry, inherited, depth + 1));
        return;
      }
      if (typeof item === "string") {
        const candidate = item.trim();
        if (
          /^(?:https?:\/\/|\/(?:api|journal|files?|media)\/)/iu.test(candidate)
        ) {
          const url = safeMaterialUrl(candidate);
          if (url)
            result.push({
              url,
              title: inherited.title || "",
              id: inherited.id || "",
            });
        }
        return;
      }
      if (typeof item !== "object") return;

      const title = firstApiText(item, [
        "original_name",
        "originalName",
        "file_name",
        "fileName",
        "filename",
        "display_name",
        "displayName",
        "attachment_name",
        "attachmentName",
        "document_name",
        "documentName",
        "name",
        "title",
        "label",
      ]);
      const id = firstApiText(item, [
        "uuid",
        "file_uuid",
        "fileUuid",
        "file_id",
        "fileId",
        "attachment_uuid",
        "attachmentUuid",
        "object_id",
        "objectId",
        "storage_id",
        "storageId",
        "id",
      ]);
      const context = {
        title: title || inherited.title || "",
        id: id || inherited.id || "",
      };
      if (context.title) {
        if (context.id) metadata.set(context.id, context);
        else if (!unnamedTitles.includes(context.title))
          unnamedTitles.push(context.title);
      }
      const directUrl = firstApiText(item, [
        "download_url",
        "downloadUrl",
        "download_link",
        "downloadLink",
        "download_uri",
        "downloadUri",
        "download",
        "signed_url",
        "signedUrl",
        "presigned_url",
        "presignedUrl",
        "file_url",
        "fileUrl",
        "attachment_url",
        "attachmentUrl",
        "object_url",
        "objectUrl",
        "file_path",
        "filePath",
        "uri",
        "url",
        "href",
        "link",
        "path",
      ]);
      const url = safeMaterialUrl(directUrl);
      if (url) {
        result.push({
          url,
          title: context.title,
          id: context.id,
        });
      }

      Object.entries(item).forEach(([key, entry]) => {
        if (
          typeof entry === "string" &&
          /(?:url|href|link|path)$/iu.test(key)
        ) {
          const nestedUrl = safeMaterialUrl(entry);
          if (nestedUrl && nestedUrl !== url) {
            result.push({
              url: nestedUrl,
              title: context.title,
              id: context.id,
            });
          }
          return;
        }
        visit(entry, context, depth + 1);
      });
    }
  }

  function firstApiText(value, keys) {
    const key = keys.find((item) => value?.[item] != null);
    return key ? cleanText(value[key]) : "";
  }

  function inferApiMaterialName(url) {
    try {
      const target = new URL(url, "https://diary.e-schools.by/");
      const disposition =
        target.searchParams.get("response-content-disposition") || "";
      const match = disposition.match(
        /filename\*?=(?:UTF-8''|["']?)([^"';]+)/iu,
      );
      if (match) return decodeURIComponent(match[1]);
      return decodeURIComponent(
        target.pathname.split("/").filter(Boolean).at(-1) || "",
      );
    } catch {
      return "";
    }
  }

  function isVisibleElement(element) {
    if (element.hidden || element.closest?.("[hidden], [aria-hidden='true']"))
      return false;
    const style =
      element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return style?.display !== "none" && style?.visibility !== "hidden";
  }

  function collectLessonMaterialRow(row, date) {
    const cells = [...row.querySelectorAll(":scope > td")];
    if (!cells.length) return null;
    const texts = cells.map((cell) => cleanText(cell.textContent));
    const startTime = texts.find((value) => /^\d{1,2}:\d{2}/.test(value)) || "";
    const subjectText =
      texts.find((value) => /^\s*(?:0|\d+)\.\s*\S+/u.test(value)) || "";
    if (!date || (!startTime && !subjectText)) return null;
    const numberMatch = subjectText.match(/^\s*(0|\d+)\./u);
    const subject = cleanText(subjectText.replace(/^\s*(?:0|\d+)\.\s*/u, ""));
    const clickable = [...row.querySelectorAll("a, button, [role='button']")];
    const candidates = clickable
      .map(describeMaterialCandidate)
      .filter((item) => item.signal)
      .slice(0, 10);
    const attachments = clickable
      .map((element) => materialFromElement(element))
      .filter(Boolean)
      .map((item) => ({
        ...item,
        source: "e-schools",
        sourceDate: date,
        sourceLessonNumber: numberMatch ? Number(numberMatch[1]) : null,
        sourceStartTime: normalizePageTime(startTime),
        sourceSubject: subject,
      }));
    return {
      date,
      number: numberMatch ? Number(numberMatch[1]) : null,
      startTime: normalizePageTime(startTime),
      subject,
      homework: texts[2] || "",
      attachments: uniqueMaterials(attachments),
      candidates,
    };
  }

  function describeMaterialCandidate(element) {
    const href = cleanText(element.getAttribute?.("href"));
    const signature = cleanText(
      [
        element.tagName,
        element.className,
        element.getAttribute?.("title"),
        element.getAttribute?.("aria-label"),
        element.getAttribute?.("data-testid"),
        element.getAttribute?.("data-tooltip"),
        href,
        element.textContent,
        element.innerHTML?.slice(0, 500),
      ].join(" "),
    );
    return {
      tag: String(element.tagName || "").toLowerCase(),
      signal:
        /(?:paperclip|attach|attachment|material|document|download|file|скреп|влож|файл)/iu.test(
          signature,
        ),
      href: safeMaterialUrl(href),
      label: cleanText(
        element.getAttribute?.("aria-label") ||
          element.getAttribute?.("title") ||
          element.textContent,
      ).slice(0, 120),
      className: cleanText(element.className).slice(0, 160),
    };
  }

  function materialFromElement(element) {
    const href = safeMaterialUrl(element.getAttribute?.("href"));
    if (!href || href === "#") return null;
    if (
      !/(?:objectsstore|download|attachment|material|document|file|journal)/iu.test(
        href,
      )
    )
      return null;
    return {
      url: href,
      title: inferMaterialName(element, href),
      id: cleanText(
        element.getAttribute?.("data-id") ||
          element.getAttribute?.("data-uuid") ||
          "",
      ),
    };
  }

  function inferMaterialName(element, href) {
    const direct = cleanText(
      element.getAttribute?.("download") ||
        element.getAttribute?.("title") ||
        element.textContent,
    );
    if (direct) return direct;
    try {
      const url = new URL(href);
      const disposition =
        url.searchParams.get("response-content-disposition") || "";
      const match = disposition.match(
        /filename\*?=(?:UTF-8''|["']?)([^"';]+)/iu,
      );
      if (match) return decodeURIComponent(match[1]);
      return decodeURIComponent(
        url.pathname.split("/").filter(Boolean).at(-1) || "",
      );
    } catch {
      return "Материал";
    }
  }

  function uniqueMaterials(materials) {
    const seen = new Set();
    return materials.filter((item) => {
      const key = `${item.url}|${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function safeMaterialUrl(value) {
    if (!value || /^(?:#|javascript:)/iu.test(value)) return "";
    try {
      const url = new URL(value, "https://diary.e-schools.by/");
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function findElementDate(element) {
    const text = cleanText(element.textContent);
    const match = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/u);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  }

  function normalizePageTime(value) {
    const match = String(value || "").match(/(\d{1,2}):(\d{2})/u);
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
  }

  function findFirstTableDate(tables) {
    const dates = tables
      .flatMap((table) => [
        ...(table.headers || []),
        ...(table.rows || []).flat(),
      ])
      .flatMap((value) => String(value).match(/\b\d{2}\.\d{2}\.\d{4}\b/g) || [])
      .map((value) => {
        const [day, month, year] = value.split(".");
        return `${year}-${month}-${day}`;
      })
      .sort();
    return dates[0] || "";
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
    collectApiMaterials,
    collectLessonMaterialRows,
    collectVisibleMaterials,
    collectPage,
    collectStudentIdentity,
    detectPageKind,
    parseTable,
  });
})(globalThis);
