class AuthService {
    constructor() {
        this.isRefreshing = false;
        this.failedQueue = [];
        this.is_login = false;
    }

    async login(json_data) {
        const response = await fetch('api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(json_data),
            credentials: 'include'
        });

        if (response.ok) {
            this.is_login = true;
            return true;
        } else {
            console.log('error in login() auth.js')
            const data = await response.json();
            return data.error;
        }
    }

    async register(json_data){
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(json_data),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            this.is_login = true;
            return true;
        } else {
            return data.error;
        }
    }

    async refreshAccessToken() {
        if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
                this.failedQueue.push({ resolve, reject });
            });
        }

        this.isRefreshing = true;

        try {
            const response = await fetch('api/refresh', {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                // Токен обновлен, сервер установил новую куку
                this.failedQueue.forEach(({ resolve }) => resolve());
                this.failedQueue = [];
                return true;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'REFRESH_FAILED');
            }
        } catch (error) {
            this.failedQueue.forEach(({ reject }) => reject(error));
            this.failedQueue = [];

            if (error.message === 'REFRESH_TOKEN_EXPIRED' || error.message === 'refresh_token_expired') {
                this.handleRefreshTokenExpired();
            }
            
            throw error;
        } finally {
            this.isRefreshing = false;
        }
    }

    handleRefreshTokenExpired() {
        console.log('Refresh token истек. Требуется полная переаутентификация.');
        this.logout();
        this.showReauthenticationRequired();
    }

    showReauthenticationRequired() {
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff6b6b;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        `;
        message.textContent = 'Сессия истекла. Пожалуйста, войдите снова.';
        document.body.appendChild(message);
        
        setTimeout(() => {
            if (document.body.contains(message)) {
                document.body.removeChild(message);
            }
        }, 5000);
    }

    async makeAuthenticatedRequest(url, options = {}) {
        options.credentials = 'include';

        let response = await fetch(url, options);
        
        // Если access token истек, пробуем обновить
        if (response.status === 401) {
            try {
                await this.refreshAccessToken();
                // Повторяем исходный запрос с обновленным токеном
                response = await fetch(url, options);
            } catch (error) {
                // Если обновление не удалось, разлогиниваем
                this.handleRefreshTokenExpired();
                return null;
            }
        }

        return response;
    }

    logout() {
        // Отправляем запрос на сервер для logout
        fetch('api/logout', {
            method: 'POST',
            credentials: 'include'
        }).catch(console.error);
        
        // Очищаем состояние
        this.is_login = false;
        
        // Принудительно перенаправляем на главную
        window.location.href = '/';
    }

    async isAuthenticated() {
        try {
            // Делаем запрос к защищенному эндпоинту для проверки аутентификации
            const response = await fetch('/api/check-auth', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                this.is_login = true;
                return true;
            } else {
                this.is_login = false;
                return false;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.is_login = false;
            return false;
        }
    }

    // Периодическая проверка состояния аутентификации
    startTokenMonitor() {
        setInterval(async () => {
            if (this.is_login) {
                const isAuth = await this.isAuthenticated();
                if (!isAuth) {
                    this.handleRefreshTokenExpired();
                }
            }
        }, 60000); // Проверка каждую минуту
    }
}

const authService = new AuthService();

document.addEventListener('DOMContentLoaded', function() {
    authService.startTokenMonitor();
});

// Дополнительные функции для использования в HTML
async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    const success = await authService.login({username, password});
    if (success === true) {
        window.location.href = '/';
    } else {
        alert('Ошибка входа. Проверьте логин и пароль.');
    }
}

// Функция для проверки аутентификации и перенаправления
async function checkAuth() {
    const isAuthenticated = await authService.isAuthenticated();
    if (!isAuthenticated && !window.location.pathname.includes('/login')) {
        window.location.href = '/login';
    }
}