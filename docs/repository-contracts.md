# Контракты репозиториев School++

## Зачем нужен этот слой

Контроллеры работают с возможностями `users`, `avatars` и `journal`, а не с
`localStorage`, URL или `fetch`. Набор обязательных методов зафиксирован в
`js/repository-contracts.js` и проверяется при сборке локальных репозиториев.

Локальная реализация возвращает значения синхронно. Серверная реализация возвращает `Promise`, но сохраняет те же названия методов и формы данных. На этапе подключения backend контроллеры получат состояния загрузки и будут ожидать результат, при этом разметку экранов и предметные преобразования менять не потребуется.

## Репозиторий журнала

```text
getJournalEntry(lessonId, studentId) -> JournalEntry | null
getLessonEntries(lessonId) -> JournalEntry[]
getLessonWork(lessonId) -> LessonWork | null
getTermGrade(termId, assignmentId, studentId) -> TermGrade | null
getTermGrades(termId, assignmentId) -> TermGrade[]
saveJournalEntry(entry) -> { entry, persisted }
saveLessonWork(work) -> { lessonWork, persisted }
saveTermGrade(entry) -> { termGrade, persisted }
mergeLessonForStudent(lesson, studentId) -> Lesson
```

`createJournalStore` реализует контракт через безопасное локальное хранилище. `createApiJournalRepository` реализует его через HTTP и использует общий `mergeJournalEntryIntoLesson`, поэтому обе версии формируют одинаковое представление урока.

## HTTP-контракт журнала

```text
GET /lessons/:lessonId/students/:studentId/journal
GET /lessons/:lessonId/journal
PUT /lessons/:lessonId/students/:studentId/journal
GET /lessons/:lessonId/work
PUT /lessons/:lessonId/work
GET /terms/:termId/assignments/:assignmentId/grades
GET /terms/:termId/assignments/:assignmentId/students/:studentId/grade
PUT /terms/:termId/assignments/:assignmentId/students/:studentId/grade
```

Сессия передаётся защищённой cookie (`credentials: include`). Клиент не отправляет `authorId`, `createdAt` и `updatedAt`: сервер обязан получить автора из сессии и самостоятельно назначить время. Ответы об ошибках имеют форму `{ message, code, details? }`; клиент преобразует их в типизированный `ApiError`.

## Граница текущего этапа

Публичная ученическая версия сохраняет импортированный снимок дневника в Supabase
под анонимной сессией браузера. API-адаптер учительского журнала готов и покрыт
тестами, но серверная запись учительских данных пока не включена: этот кабинет
будет подключён после проверки с добровольцем-учителем.
