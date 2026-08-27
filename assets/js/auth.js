/*
 * auth.js
 * Quiz Portal authentication helper
 * - Provides the application entry gate and logout behavior
 * - Adds a splash redirect for index.html only after entry access is granted
 */
(function(){
    const ENTRY_PASSWORD = 'Saurabh7752';
    const ENTRY_SESSION_KEY = 'quizEntryAuthenticated';

    function isEntryAuthenticated(){
        return sessionStorage.getItem(ENTRY_SESSION_KEY) === 'true';
    }

    function login(){
        return true;
    }

    function logout(){
        try{
            sessionStorage.removeItem(ENTRY_SESSION_KEY);
            window.location.href = 'index.html';
        }catch(e){}
    }

    function protectPage(){
        return isEntryAuthenticated();
    }

    function createEntryGate(){
        if (isEntryAuthenticated() || document.getElementById('entryGate')) return;

        const gate = document.createElement('div');
        gate.id = 'entryGate';
        gate.className = 'entry-gate';
        gate.innerHTML = `
            <form class="entry-gate-card" novalidate>
                <span class="entry-gate-kicker">Quiz Portal</span>
                <h1>Enter Entry Password</h1>
                <label for="entryPassword">Password</label>
                <input id="entryPassword" type="password" autocomplete="current-password" required />
                <p id="entryError" class="entry-error" role="alert" aria-live="polite"></p>
                <button type="submit" class="btn btn-primary">Enter Quiz</button>
            </form>
        `;

        document.body.appendChild(gate);
        const form = gate.querySelector('form');
        const input = gate.querySelector('#entryPassword');
        const error = gate.querySelector('#entryError');
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (input.value === ENTRY_PASSWORD) {
                sessionStorage.setItem(ENTRY_SESSION_KEY, 'true');
                gate.remove();
                document.body.classList.remove('entry-locked');
                input.value = '';
            } else {
                error.textContent = 'Incorrect entry password.';
                input.select();
            }
        });
        input.focus();
    }

    function attachLogoutHandler(){
        document.addEventListener('DOMContentLoaded', ()=>{
            const el = document.getElementById('logoutBtn');
            if(el){ el.addEventListener('click', (ev)=>{ ev.preventDefault(); logout(); }); }
        });
    }

    if((location.pathname === '/' || location.pathname.endsWith('/index.html')) && isEntryAuthenticated()){
        window.setTimeout(function(){
            window.location.href = 'dashboard.html';
        }, 10000);
    }

    const authAPI = {
        login,
        logout,
        protectPage,
        isEntryAuthenticated
    };

    window.auth = authAPI;
    window.__quizAuth = authAPI;

    document.addEventListener('DOMContentLoaded', () => {
        if (!isEntryAuthenticated()) {
            document.body.classList.add('entry-locked');
            createEntryGate();
        }
    });
    attachLogoutHandler();
})();

