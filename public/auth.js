document.addEventListener('DOMContentLoaded', () => {

    // login logic
    const loginForm = document.getElementById('loginFormActual');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const btn = loginForm.querySelector('.btn-submit');
            const originalText = btn.innerText;

            // set loading state
            btn.innerText = "LOGGING IN...";
            btn.disabled = true;

            try {
                const res = await fetch('https://studentworkhub.onrender.com/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();

                if (data.success) {
                    localStorage.setItem('studentUser', JSON.stringify({
                        name: data.userName, email: email, isLoggedIn: true
                    }));
                    window.location.href = 'index.html';
                } else {
                    if (data.requireOtp) {
                        window.location.href = `otp.html?email=${encodeURIComponent(data.email)}&role=student`;
                        return;
                    }
                    showNotification('Login Failed', data.message || 'Invalid credentials.', false);
                }
            } catch (err) {
                showNotification('Connection Error', 'Ensure the server is running.', false);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }

    // registration logic
    const regForm = document.getElementById('registerFormActual');
    if (regForm) {
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // collect form data
            const formData = {
                firstName: document.getElementById('regFirstName').value,
                lastName: document.getElementById('regLastName').value,
                email: document.getElementById('regEmail').value,
                phone: document.getElementById('regPhone').value,
                dob: document.getElementById('regDOB').value,
                city: document.getElementById('regCity').value,
                password: document.getElementById('regPassword').value,
                confirm: document.getElementById('regConfirm').value
            };

            if (formData.password !== formData.confirm) {
                return showNotification('Password Error', 'Passwords do not match.', false);
            }

            const btn = regForm.querySelector('.btn-submit');
            const originalText = btn.innerText;
            btn.innerText = "CREATING...";
            btn.disabled = true;

            try {
                const res = await fetch('https://studentworkhub.onrender.com/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                const data = await res.json();

                if (data.success) {
                    if (data.requireOtp) {
                        window.location.href = `otp.html?email=${encodeURIComponent(data.email)}&role=student`;
                        return;
                    }

                    showNotification('Account Created!', 'Please log in.', true);
                    regForm.reset();

                    // switch to login tab on modal close
                    document.querySelector('.modal-btn').onclick = () => {
                        closeModal();
                        window.switchTab('login');
                    };
                } else {
                    showNotification('Registration Failed', data.message, false);
                    document.querySelector('.modal-btn').onclick = closeModal;
                }
            } catch (err) {
                console.error(err);
                showNotification('Server Error', 'Could not connect.', false);
                document.querySelector('.modal-btn').onclick = closeModal;
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }
});