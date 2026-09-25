# Подключение Supabase

В опубликованной версии ученик не создаёт отдельный логин School++. Браузер
получает анонимную учётную запись Supabase, а расширение сохраняет в неё один
актуальный снимок дневника. Сессия остаётся в браузере и обновляется SDK.

## Настройка проекта

1. В Supabase откройте **Authentication → Providers → Anonymous Sign-Ins** и
   разрешите анонимные входы.
2. В **SQL Editor** один раз выполните
   `supabase/migrations/202609150001_personal_diary.sql`.
3. Затем один раз выполните
   `supabase/migrations/202609200001_support_chat.sql`.
4. Для заявок на подключение других дневников один раз выполните
   `supabase/migrations/202609250001_diary_requests.sql`.
5. Для панели управления и обезличенной статистики выполните
   `supabase/migrations/202609250002_admin_dashboard.sql`.
6. Для статуса прочтения сообщений выполните
   `supabase/migrations/202609260001_support_read_receipts.sql`.
7. В **Table Editor** проверьте RLS у `diary_snapshots`,
   `support_conversations`, `support_messages`, `support_agents` и
   `diary_requests`. У `site_activity_daily` прямой доступ для клиентов должен
   оставаться закрытым.
8. В настройках хостинга задайте:

```text
VITE_APP_MODE=cloud
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

В `VITE_*` нельзя помещать database password, secret или `service_role`: Vite
включает эти значения в браузерную сборку. Локальный `.env.local` исключён из
Git.

## Аккаунт поддержки

В **Authentication → Users** создайте пользователя с адресом
`support@schoolpp.com`, включите автоматическое подтверждение и задайте длинный
уникальный пароль. Пароль хранится только в Supabase и менеджере паролей.

После создания назначьте роль оператора в SQL Editor:

```sql
insert into public.support_agents (user_id, display_name)
select id, 'Поддержка'
from auth.users
where email = 'support@schoolpp.com'
on conflict (user_id) do update
set display_name = excluded.display_name;
```

Оператор входит на `/support.html` с логином `support` и своим паролем. Клиент
не может сам назначить эту роль. Политики RLS дают ученику доступ только к своим
данным и беседам, а оператору — к обращениям поддержки.

Та же учётная запись открывает `/control.html`. Новая миграция выдаёт право на
панель управления именно существующему пользователю `support@schoolpp.com`;
будущие операторы поддержки такого права автоматически не получают.

## Хранение и синхронизация

`diary_snapshots` содержит один актуальный JSON-снимок на пользователя и
источник `e-schools.by`. При открытом School++ данные сохраняются сразу. После
фонового обновления расширение может ненадолго открыть служебную вкладку
School++, дождаться записи в Supabase и закрыть её.

Кнопка удаления в расширении очищает локальный снимок и открывает служебную
вкладку для удаления записи из Supabase. Логины, пароли, cookies, токены,
ответы авторизации и CAPTCHA в снимок не входят.

Поддержка использует отдельные таблицы бесед, сообщений и заявок на новые
дневники. Новые записи передаются через Supabase Realtime; закрытую оператором
беседу нельзя продолжить. Заявки видны их автору и операторам поддержки.
