// nexxore Landing Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize all functionality
    initSmoothScrolling();
    initWaitlistForm();
    initScrollAnimations();
    initParallaxEffects();
    initTooltips();
    initStrategyCards();
});

// Smooth Scrolling for Navigation Links
function initSmoothScrolling() {
    const navLinks = document.querySelectorAll('a[href^="#"]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                const navbarHeight = document.querySelector('.navbar').offsetHeight;
                const targetPosition = targetSection.offsetTop - navbarHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Strategy cards: expand / keyboard support
function initStrategyCards(){
    const cards = document.querySelectorAll('.strategy-card');
    const modal = document.getElementById('strategyModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = modal?.querySelector('.modal-body');
    const modalClose = modal?.querySelector('.modal-close');
    const modalOverlay = modal?.querySelector('.modal-overlay');
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');
    
    if(!cards) return;

    const openModal = (title, content, confirmAction) => {
        if(!modal) return;
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        
        if(confirmAction){
            modalConfirm.onclick = () => {
                confirmAction();
                closeModal();
            };
        }
    };

    const closeModal = () => {
        if(!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    };

    if(modalClose) modalClose.addEventListener('click', closeModal);
    if(modalOverlay) modalOverlay.addEventListener('click', closeModal);
    if(modalCancel) modalCancel.addEventListener('click', closeModal);

    cards.forEach(card => {
        const strategyName = card.querySelector('.strategy-name')?.textContent || 'Strategy';
        
        // Toggle expanded state on click (not on action buttons)
        card.addEventListener('click', (e)=>{
            if(e.target.closest('.strategy-actions')) return;
            card.classList.toggle('expanded');
        });

        card.addEventListener('keydown', (e)=>{
            if(e.key === 'Enter' || e.key === ' '){
                e.preventDefault();
                card.classList.toggle('expanded');
            }
        });

        const inspect = card.querySelector('.inspect');
        if(inspect) inspect.addEventListener('click',(e)=>{
            e.stopPropagation();
            openModal(
                `Inspect ${strategyName}`,
                `<p><strong>Strategy Logic:</strong></p>
                <ul>
                  <li>Entry conditions: [Logic placeholder]</li>
                  <li>Exit rules: [Logic placeholder]</li>
                  <li>Risk parameters: [Risk placeholder]</li>
                </ul>
                <p><strong>Execution Logic Graph:</strong></p>
                <div style="background:rgba(255,255,255,0.02);padding:20px;border-radius:8px;text-align:center;color:var(--muted);">[Visual logic flow placeholder]</div>`,
                null
            );
        });
        
        const simulate = card.querySelector('.simulate');
        if(simulate) simulate.addEventListener('click',(e)=>{
            e.stopPropagation();
            openModal(
                `Simulate ${strategyName} Allocation`,
                `<p><strong>Simulation Parameters:</strong></p>
                <label style="display:block;margin:12px 0">Capital Amount: <input type="number" placeholder="1000" style="margin-left:8px;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:inherit"/></label>
                <label style="display:block;margin:12px 0">Duration (days): <input type="number" placeholder="30" style="margin-left:8px;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:inherit"/></label>
                <p style="margin-top:16px;color:var(--muted)">Click Confirm to run simulation with historical data.</p>`,
                () => alert('Running simulation...')
            );
        });
        
        const viewLogic = card.querySelector('.view-logic');
        if(viewLogic) viewLogic.addEventListener('click',(e)=>{
            e.stopPropagation();
            openModal(
                `${strategyName} Execution Logic`,
                `<p><strong>On-Chain Execution Logic:</strong></p>
                <pre style="background:rgba(255,255,255,0.02);padding:16px;border-radius:8px;overflow-x:auto;font-size:0.9rem;color:var(--muted)">
function execute(market, position) {
  if (condition_met()) {
    open_position();
    set_stop_loss();
  }
  if (exit_signal()) {
    close_position();
  }
}
                </pre>
                <p style="margin-top:12px;color:var(--muted)">All logic is deterministic and verifiable on-chain.</p>`,
                null
            );
        });
    });

    // ESC key closes modal
    document.addEventListener('keydown', (e) => {
        if(e.key === 'Escape' && modal?.classList.contains('active')){
            closeModal();
        }
    });
}

// Waitlist Form Handling
function initWaitlistForm() {
    const form = document.getElementById('waitlistForm');
    
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const wallet = document.getElementById('wallet').value;
            const submitBtn = form.querySelector('button[type="submit"]');
            
            // Validate email
            if (!isValidEmail(email)) {
                showNotification('Please enter a valid email address', 'error');
                return;
            }
            
            // Show loading state
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Joining...';
            submitBtn.disabled = true;
            
            const WAITLIST_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzfgnxfO9tUHiE5w642YB5V7B7uA82m58DYF6dF_vRbQ2n2mdkqmzUmnPwwJxhAYdSq/exec';

            async function doSubmit() {
                try {
                    const res = await fetch(WAITLIST_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, wallet })
                    });

                    // Apps Script often returns 200 with JSON text
                    const text = await res.text();
                    let data = {};
                    try { data = JSON.parse(text); } catch (err) { data = { ok: true }; }

                    if (!res.ok) {
                        throw new Error(data.error || ('Request failed: ' + res.status));
                    }

                    form.reset();
                    showNotification('Successfully joined the waitlist! We\'ll be in touch soon.', 'success');
                    trackWaitlistSignup(email, wallet);
                } catch (err) {
                    console.error('Waitlist submission error:', err);
                    showNotification('Submission failed. Try again later.', 'error');
                } finally {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            }

            doSubmit();
        });
    }
}

// Email Validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Notification System
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close">&times;</button>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${type === 'error' ? '#ff4444' : '#00d4ff'};
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        z-index: 10000;
        transform: translateX(400px);
        transition: transform 0.3s ease;
        max-width: 400px;
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        notification.style.transform = 'translateX(400px)';
        setTimeout(() => notification.remove(), 300);
    });
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.transform = 'translateX(400px)';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Scroll Animations
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                
                // Stagger animations for child elements
                const childElements = entry.target.querySelectorAll('.flow-step, .agent-card, .stat-item');
                childElements.forEach((child, index) => {
                    setTimeout(() => {
                        child.classList.add('animate-in');
                    }, index * 100);
                });
            }
        });
    }, observerOptions);
    
    // Observe sections for animation
    const animatedSections = document.querySelectorAll('.nusd-section, .agents-section, .portfolio-section, .waitlist-section');
    animatedSections.forEach(section => {
        observer.observe(section);
    });
    
    // Add CSS for animations
    addAnimationStyles();
}

// Add Animation Styles
function addAnimationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .nusd-section, .agents-section, .portfolio-section, .waitlist-section {
            opacity: 0;
            transform: translateY(30px);
            transition: opacity 0.8s ease, transform 0.8s ease;
        }
        
        .nusd-section.animate-in, .agents-section.animate-in, 
        .portfolio-section.animate-in, .waitlist-section.animate-in {
            opacity: 1;
            transform: translateY(0);
        }
        
        .flow-step, .agent-card, .stat-item {
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.6s ease, transform 0.6s ease;
        }
        
        .flow-step.animate-in, .agent-card.animate-in, .stat-item.animate-in {
            opacity: 1;
            transform: translateY(0);
        }
        
        .notification-content {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .notification-close {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .notification-close:hover {
            opacity: 0.7;
        }
    `;
    document.head.appendChild(style);
}

// Parallax Effects
function initParallaxEffects() {
    let ticking = false;
    
    function updateParallax() {
        const scrolled = window.pageYOffset;
        const parallaxElements = document.querySelectorAll('.gradient-orb');
        
        parallaxElements.forEach((element, index) => {
            const speed = 0.5 + (index * 0.2);
            const yPos = -(scrolled * speed);
            element.style.transform = `translate3d(0, ${yPos}px, 0)`;
        });
        
        ticking = false;
    }
    
    function requestTick() {
        if (!ticking) {
            requestAnimationFrame(updateParallax);
            ticking = true;
        }
    }
    
    window.addEventListener('scroll', requestTick);
}

// Tooltips for Disabled Buttons
function initTooltips() {
    const disabledButtons = document.querySelectorAll('.btn-disabled[title]');
    
    disabledButtons.forEach(button => {
        let tooltip = null;
        
        button.addEventListener('mouseenter', function(e) {
            const title = this.getAttribute('title');
            if (!title) return;
            
            // Create tooltip
            tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            tooltip.textContent = title;
            tooltip.style.cssText = `
                position: absolute;
                background: #333;
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                z-index: 1000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s ease;
                white-space: nowrap;
            `;
            
            document.body.appendChild(tooltip);
            
            // Position tooltip
            const rect = this.getBoundingClientRect();
            tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
            tooltip.style.top = rect.top - tooltip.offsetHeight - 8 + 'px';
            
            // Show tooltip
            setTimeout(() => {
                if (tooltip) tooltip.style.opacity = '1';
            }, 100);
        });
        
        button.addEventListener('mouseleave', function() {
            if (tooltip) {
                tooltip.style.opacity = '0';
                setTimeout(() => {
                    if (tooltip && tooltip.parentNode) {
                        tooltip.remove();
                    }
                }, 300);
                tooltip = null;
            }
        });
    });
}

// Analytics Tracking (placeholder)
function trackWaitlistSignup(email, wallet) {
    // Replace with actual analytics tracking
    console.log('Waitlist signup:', { email, wallet, timestamp: new Date().toISOString() });
    
    // Example Google Analytics event
    // gtag('event', 'signup', {
    //     event_category: 'waitlist',
    //     event_label: 'hero_cta'
    // });
}

// Navbar Scroll Effect
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(10, 10, 10, 0.95)';
    } else {
        navbar.style.background = 'rgba(10, 10, 10, 0.9)';
    }
});

// Handle reduced motion preference
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Disable animations for users who prefer reduced motion
    const style = document.createElement('style');
    style.textContent = `
        *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
        }
    `;
    document.head.appendChild(style);
}

// Performance optimization: Debounce scroll events
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Error handling
window.addEventListener('error', function(e) {
    console.error('JavaScript error:', e.error);
    // Could send to error tracking service here
});

// Service worker registration (for future PWA capabilities)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        // navigator.serviceWorker.register('/sw.js')
        //     .then(function(registration) {
        //         console.log('ServiceWorker registration successful');
        //     })
        //     .catch(function(err) {
        //         console.log('ServiceWorker registration failed');
        //     });
    });
}