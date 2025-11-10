# insightroom-frontend


personal-cabinet.html:

## Параметры, передаваемые на страницу  (Flask → HTML)

**Основные:**
- `user_name` (string) - имя пользователя
- `user_login` (string) - логин пользователя

**Мои встречи:**
- `sessions_count` (number) - количество встреч
- `current_meetings` (Meeting[]) - список встреч
- `meeting.id` (string) - уникальный идентификатор
- `meeting.title` (string) - заголовок
- `meeting.status` (string) - статус встречи ("Запланировано", "Активно")
- `meeting.description` (string) - описание встречи

**Все встречи**
- `all_meetings_count` (number) - Общее количество всех встреч
- `all_meetings` (Meeting[]) - Список всех доступных встреч
- `meeting.id` (string) - Уникальный идентификатор встречи
- `meeting.title` (string) - Заголовок встречи
- `meeting.status` (string) - Статус встречи
- `meeting.description` (string) - Описание встречи

**Контакты:**
- `contacts_count` (number) - Количество контактов пользователя
- `contacts` (Contact[]) - Список контактов пользователя
- `contact.initials` (string) - Инициалы контакта (2 символа)
- `contact.name` (string) - Полное имя контакта
- `contact.login` (string) - Логин контакта

## Параметры, вводимые пользователем (HTML → JavaScript)

**Запланировать встречу**
- `meeting.title` (string) - Название встречи
- `meeting.date` (string) - Дата встречи (формат YYYY-MM-DD)
- `meeting.time` (string) - Время встречи (формат HH:MM)
- `meeting.description` (string) - Описание встречи

**Присоединиться к встрече**
- `meeting.id` (string) - Идентификатор встречи или ссылка

**Создать комнату**
- `room.name` (string) - Название комнаты
- `room.description` (string) - Описание комнаты

**Добавить контакт**
- `contact.name` (string) - Имя контакта
- `contact.login` (string) - Логин пользователя

**Настройки системы**
- `theme` (string) - Тема интерфейса ("light", "dark")
- `privacy.phone` (string) - Видимость номера телефона ("everyone", "contacts", "nobody")
- `privacy.photo` (string) - Видимость фото профиля ("everyone", "contacts", "nobody")
- `privacy.email` (string) - Видимость email ("everyone", "contacts", "nobody")