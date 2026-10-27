// Page navigation sometimes touches the pupil banner without whitespace.
// Remove only known navigation labels, preserving ordinary names/initials.
function cleanStudentName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .split(/текущие\s*уроки|итоговые\s*отметки/iu)[0]
    .replace(/\s*(?:текущие|итоговые)$/iu, "")
    .replace(/[,;:]+$/, "")
    .trim();
}

export { cleanStudentName };
