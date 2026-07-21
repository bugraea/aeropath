/* =============================================
   AEROPATH - Giriş Ekranı JavaScript
   Ağ Animasyonu, Form Doğrulama, Etkileşimler
   ============================================= */

(function () {
    'use strict';

    // ============================================
    // 1. ANIMATED NETWORK BACKGROUND (Canvas)
    // ============================================

    const canvas = document.getElementById('networkCanvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    let animFrameId;

    const NETWORK_CONFIG = {
        particleCount: 60,
        connectionDistance: 160,
        particleSize: { min: 1, max: 2.5 },
        speed: { min: 0.15, max: 0.4 },
        lineOpacity: 0.07,
        particleOpacity: { min: 0.15, max: 0.45 },
        color: { r: 59, g: 130, b: 246 } // accent blue
    };

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = NETWORK_CONFIG.particleSize.min +
                Math.random() * (NETWORK_CONFIG.particleSize.max - NETWORK_CONFIG.particleSize.min);
            this.speedX = (Math.random() - 0.5) * 2 *
                (NETWORK_CONFIG.speed.min + Math.random() * (NETWORK_CONFIG.speed.max - NETWORK_CONFIG.speed.min));
            this.speedY = (Math.random() - 0.5) * 2 *
                (NETWORK_CONFIG.speed.min + Math.random() * (NETWORK_CONFIG.speed.max - NETWORK_CONFIG.speed.min));
            this.opacity = NETWORK_CONFIG.particleOpacity.min +
                Math.random() * (NETWORK_CONFIG.particleOpacity.max - NETWORK_CONFIG.particleOpacity.min);
            this.pulseSpeed = 0.005 + Math.random() * 0.01;
            this.pulsePhase = Math.random() * Math.PI * 2;
        }

        update() {
            this.x += this.speedX;
            this.y += this.speedY;

            // Wrap around edges
            if (this.x < -10) this.x = canvas.width + 10;
            if (this.x > canvas.width + 10) this.x = -10;
            if (this.y < -10) this.y = canvas.height + 10;
            if (this.y > canvas.height + 10) this.y = -10;

            // Pulse opacity
            this.pulsePhase += this.pulseSpeed;
            this.currentOpacity = this.opacity * (0.6 + 0.4 * Math.sin(this.pulsePhase));
        }

        draw() {
            const { r, g, b } = NETWORK_CONFIG.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${this.currentOpacity})`;
            ctx.fill();

            // Glow
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${this.currentOpacity * 0.1})`;
            ctx.fill();
        }
    }

    function initParticles() {
        particles = [];
        for (let i = 0; i < NETWORK_CONFIG.particleCount; i++) {
            particles.push(new Particle());
        }
    }

    function drawConnections() {
        const { r, g, b } = NETWORK_CONFIG.color;
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < NETWORK_CONFIG.connectionDistance) {
                    const opacity = NETWORK_CONFIG.lineOpacity *
                        (1 - dist / NETWORK_CONFIG.connectionDistance);
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function animateNetwork() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
            p.update();
            p.draw();
        });

        drawConnections();
        animFrameId = requestAnimationFrame(animateNetwork);
    }

    // Initialize
    resizeCanvas();
    initParticles();
    animateNetwork();

    window.addEventListener('resize', () => {
        resizeCanvas();
        initParticles();
    });

    // ============================================
    // 2. CLOCK / TIME DISPLAY
    // ============================================

    const timeEl = document.getElementById('currentTime');

    function updateTime() {
        const now = new Date();
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        timeEl.textContent = now.toLocaleString('tr-TR', options);
    }

    updateTime();
    setInterval(updateTime, 1000);

    // ============================================
    // 3. PASSWORD TOGGLE
    // ============================================

    const passwordInput = document.getElementById('password');
    const toggleBtn = document.getElementById('passwordToggle');
    const eyeOpen = toggleBtn.querySelector('.eye-open');
    const eyeClosed = toggleBtn.querySelector('.eye-closed');

    toggleBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        eyeOpen.style.display = isPassword ? 'none' : 'block';
        eyeClosed.style.display = isPassword ? 'block' : 'none';
    });

    // ============================================
    // 4. FORM VALIDATION & SUBMISSION
    // ============================================

    const loginForm = document.getElementById('loginForm');
    const badgeInput = document.getElementById('badgeId');
    const submitBtn = document.getElementById('submitBtn');
    const loginCard = document.getElementById('loginCard');
    const badgeGroup = document.getElementById('badgeGroup');
    const passwordGroup = document.getElementById('passwordGroup');

    function setError(group, message) {
        group.classList.add('error');

        // Remove existing error
        const existing = group.querySelector('.error-message');
        if (existing) existing.remove();

        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            ${message}
        `;
        group.appendChild(errorEl);
    }

    function clearError(group) {
        group.classList.remove('error');
        const existing = group.querySelector('.error-message');
        if (existing) existing.remove();
    }

    // Clear errors on input
    badgeInput.addEventListener('input', () => clearError(badgeGroup));
    passwordInput.addEventListener('input', () => clearError(passwordGroup));

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();

        let isValid = true;

        // Validate badge
        if (!badgeInput.value.trim()) {
            setError(badgeGroup, 'Rozet numarası gereklidir.');
            isValid = false;
        }

        // Validate password
        if (!passwordInput.value.trim()) {
            setError(passwordGroup, 'Şifre gereklidir.');
            isValid = false;
        }

        if (!isValid) {
            loginCard.classList.add('shake');
            setTimeout(() => loginCard.classList.remove('shake'), 500);
            return;
        }

        // Simulate login
        submitBtn.classList.add('loading');

        setTimeout(() => {
            submitBtn.classList.remove('loading');
            loginCard.classList.add('success');

            // Show success feedback
            const btnText = submitBtn.querySelector('.btn-text');
            const btnIcon = submitBtn.querySelector('.btn-icon');
            btnText.textContent = 'Erişim Sağlandı';
            btnIcon.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
            submitBtn.style.background = 'linear-gradient(135deg, #10B981 0%, #059669 100%)';
            submitBtn.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.35)';

            // Fade out card and redirect to dashboard
            setTimeout(() => {
                loginCard.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                loginCard.style.opacity = '0';
                loginCard.style.transform = 'translateY(-10px) scale(0.98)';
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 700);
            }, 1500);
        }, 2000);
    });

    // ============================================
    // 5. KEYBOARD ACCESSIBILITY
    // ============================================

    // Focus first input on load
    setTimeout(() => badgeInput.focus(), 800);

    // Tab index management
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement === badgeInput) {
            e.preventDefault();
            passwordInput.focus();
        }
    });

    // ============================================
    // 6. SUBTLE CARD PARALLAX ON MOUSE MOVE
    // ============================================

    document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;

        loginCard.style.transform = `perspective(1000px) rotateY(${x * 0.5}deg) rotateX(${-y * 0.5}deg)`;
    });

    document.addEventListener('mouseleave', () => {
        loginCard.style.transform = 'perspective(1000px) rotateY(0deg) rotateX(0deg)';
    });

})();
