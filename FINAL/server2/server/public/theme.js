/**
 * Plate2Plate Theme Management
 * Handles dark/light mode switching and persistence
 */

const themeToggleBtn = `
    <button id="theme-toggle" class="btn btn-secondary" style="padding: 0.5rem; border-radius: var(--radius-full); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;" title="Toggle Dark/Light Mode">
        <span class="theme-icon">🌞</span>
    </button>
`;

function initTheme() {
    const savedTheme = localStorage.getItem('plate2plate_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateToggleIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('plate2plate_theme', newTheme);
    updateToggleIcon(newTheme);
}

function updateToggleIcon(theme) {
    const iconSpan = document.querySelector('#theme-toggle .theme-icon');
    if (iconSpan) {
        iconSpan.textContent = theme === 'light' ? '🌞' : '🌙';
    }
}

// Inject toggle into navbar
// Inject toggle into navbar or specific container
window.addEventListener('DOMContentLoaded', () => {
    let container = document.querySelector('.navbar .container');
    let anchor = null;

    if (container) {
        anchor = container.querySelector('.flex.items-center.gap-md') ||
            container.querySelector('.flex.items-center.gap-lg') ||
            document.getElementById('user-nav');
    } else {
        // Fallback for pages without standard navbar (like auth page)
        anchor = document.getElementById('theme-toggle-container');
    }

    if (anchor) {
        const toggleWrapper = document.createElement('div');
        toggleWrapper.innerHTML = themeToggleBtn;
        anchor.prepend(toggleWrapper.firstElementChild);

        const btn = document.getElementById('theme-toggle');
        btn.addEventListener('click', toggleTheme);
        updateToggleIcon(document.documentElement.getAttribute('data-theme'));
    }
});

initTheme();
