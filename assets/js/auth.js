/*
 * auth.js
 * Quiz Portal authentication helper
 * - Stores the site password in localStorage under key `quizPortalPassword` (as requested)
 * - Uses sessionStorage `quizAuthenticated` to mark an active session
 * - Provides a localStorage fallback for browser file:// navigation where sessionStorage may not survive page-bound navigation
 * - Exposes modular methods for login, logout, password change and recovery
 * - Protects pages automatically when loaded (skips index.html)
 */
(function(){
    const AUTH_FLAG = 'quizAuthenticated';
    const PASSWORD_KEY = 'quizPortalPassword';
    const DEFAULT_PASSWORD = 'Mayank#123';
    const VERIFICATION_CODE = 'maya8932';

    function ensureDefaultPassword(){
        try{
            const p = localStorage.getItem(PASSWORD_KEY);
            if(p === null){
                localStorage.setItem(PASSWORD_KEY, DEFAULT_PASSWORD);
            }
        }catch(e){ console.error('auth: ensureDefaultPassword', e); }
    }

    function getStoredPassword(){
        try{ return localStorage.getItem(PASSWORD_KEY); }catch(e){ return null; }
    }

    function setStoredPassword(newPw){
        try{ localStorage.setItem(PASSWORD_KEY, newPw); return true; }catch(e){ console.error('auth: setStoredPassword', e); return false; }
    }

    function setAuthFlag(){
        try{
            sessionStorage.setItem(AUTH_FLAG, 'true');
            localStorage.setItem(AUTH_FLAG, 'true');
        }catch(e){ console.error('auth: setAuthFlag', e); }
    }

    function clearAuthFlag(){
        try{ sessionStorage.removeItem(AUTH_FLAG); }catch(e){}
        try{ localStorage.removeItem(AUTH_FLAG); }catch(e){}
    }

    function isAuthenticated(){
        try{
            const sessionValue = sessionStorage.getItem(AUTH_FLAG);
            const localValue = localStorage.getItem(AUTH_FLAG);
            if(sessionValue === 'true'){
                return true;
            }
            if(localValue === 'true'){
                sessionStorage.setItem(AUTH_FLAG, 'true');
                return true;
            }
            return false;
        }catch(e){ return false; }
    }

    function login(password){
        try{
            ensureDefaultPassword();
            const stored = getStoredPassword();
            if(password === stored){
                setAuthFlag();
                return true;
            }
            return false;
        }catch(e){ console.error('auth: login', e); return false; }
    }

    function logout(){
        clearAuthFlag();
        try{ window.location.href = 'index.html'; }catch(e){}
    }

    function changePassword(code, newPassword, confirmPassword){
        try{
            if(code !== VERIFICATION_CODE){
                return { success:false, message:'Invalid verification code.' };
            }

            if(!newPassword || newPassword.trim() === ''){
                return { success:false, message:'Password cannot be empty.' };
            }

            if(newPassword !== confirmPassword){
                return { success:false, message:'Passwords do not match.' };
            }

            localStorage.setItem(PASSWORD_KEY, newPassword);
            return { success:true, message:'Password changed successfully.' };
        }catch(e){
            console.error('auth: changePassword', e);
            return { success:false, message:'Unable to change password.' };
        }
    }

    function protectPage(){
        try{
            const path = location.pathname || '';
            const filename = path.split('/').pop() || '';
            const isIndex = filename === '' || filename === 'index.html' || filename === '/';
            const isPasswordPage = filename === 'change-password.html';
            if(isIndex || isPasswordPage) return;
            if(!isAuthenticated()){
                window.location.href = 'index.html';
            }
        }catch(e){ console.error('auth: protectPage', e); }
    }

    function attachLogoutHandler(){
        document.addEventListener('DOMContentLoaded', ()=>{
            const el = document.getElementById('logoutBtn');
            if(el){ el.addEventListener('click', (ev)=>{ ev.preventDefault(); logout(); }); }
            const cp = document.getElementById('changePasswordBtn');
            if(cp){ cp.addEventListener('click', (ev)=>{ ev.preventDefault(); window.location.href='change-password.html'; }); }
        });
    }

    const authAPI = {
        ensureDefaultPassword,
        login,
        logout,
        changePassword,
        protectPage
    };

    window.auth = authAPI;
    window.__quizAuth = authAPI;

    ensureDefaultPassword();
    attachLogoutHandler();
    protectPage();
})();

