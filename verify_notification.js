const fs = require('fs');

async function run() {
    const timestamp = Date.now();
    const empEmail = `emp_${timestamp}@test.com`;
    const stuEmail = `stu_${timestamp}@test.com`;
    const baseUrl = 'http://localhost:3000';

    console.log("Starting verification...");

    try {
        // 1. Register Employer
        console.log("Registering Employer...");
        const empForm = new FormData();
        empForm.append('companyName', 'Test Corp ' + timestamp);
        empForm.append('brNumber', 'BR123');
        empForm.append('industry', 'Tech');
        empForm.append('address', '123 St');
        empForm.append('city', 'Colombo');
        empForm.append('email', empEmail);
        empForm.append('phone', '1234567890');
        empForm.append('password', 'password');
        
        // Mock file for brFile
        const fileBlob = new Blob(['dummy'], { type: 'text/plain' });
        empForm.append('brFile', fileBlob, 'dummy.txt');

        let res = await fetch(`${baseUrl}/api/register-employer`, {
            method: 'POST',
            body: empForm
        });
        let json = await res.json();
        if (!json.success) throw new Error("Employer registration failed: " + json.message);

        // 2. Register Student
        console.log("Registering Student...");
        res = await fetch(`${baseUrl}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                firstName: 'John',
                lastName: 'Doe',
                email: stuEmail,
                phone: '0987654321',
                dob: '2000-01-01',
                city: 'Colombo',
                password: 'password'
            })
        });
        json = await res.json();
        if (!json.success) throw new Error("Student registration failed: " + json.message);

        // 3. Post Job (Employer)
        console.log("Posting Job...");
        const jobForm = new FormData();
        jobForm.append('employerEmail', empEmail);
        jobForm.append('companyName', 'Test Corp ' + timestamp);
        jobForm.append('jobTitle', 'Verification Engineer ' + timestamp); // UNIQUE TITLE
        jobForm.append('location', 'Colombo');
        jobForm.append('category', 'IT');
        jobForm.append('schedule', 'Weekdays');
        jobForm.append('hoursPerDay', '4');
        jobForm.append('payAmount', '1000');
        jobForm.append('payFrequency', 'Per Hour');
        jobForm.append('description', 'Test Description');
        jobForm.append('isPremium', '0');
        jobForm.append('deadline', '2030-01-01');
        // posters not strictly required by my code but let's add one
        jobForm.append('posters', fileBlob, 'dummy.txt');

        res = await fetch(`${baseUrl}/api/post-job`, {
            method: 'POST',
            body: jobForm
        });
        json = await res.json();
        if (!json.success) throw new Error("Job posting failed");

        // 4. Get Job ID
        res = await fetch(`${baseUrl}/api/my-jobs/${empEmail}`);
        json = await res.json();
        if (!json.success || json.jobs.length === 0) throw new Error("Could not fetch posted job");
        const jobId = json.jobs[0].id;
        const jobTitle = json.jobs[0].jobTitle;
        console.log(`Job Posted. ID: ${jobId}, Title: ${jobTitle}`);

        // 5. Apply for Job (Student)
        console.log("Applying for Job...");
        const applyForm = new FormData();
        applyForm.append('jobId', jobId);
        applyForm.append('studentEmail', stuEmail);
        applyForm.append('useExisting', 'false');
        applyForm.append('newCv', fileBlob, 'dummy.txt');

        res = await fetch(`${baseUrl}/api/apply-job`, {
            method: 'POST',
            body: applyForm
        });
        json = await res.json();
        if (!json.success) throw new Error("Application failed: " + json.message);

        // 6. Check Notifications (Employer)
        console.log("Checking Notifications...");
        res = await fetch(`${baseUrl}/api/notifications/${empEmail}`);
        json = await res.json();
        if (!json.success) throw new Error("Could not fetch notifications");
        
        const notif = json.notifications.find(n => n.message.includes("New application"));
        if (!notif) {
            console.error("FAIL: Notification not found in list.", json.notifications);
        } else {
            console.log(`Notification Found: "${notif.message}"`);
            if (notif.message.includes("undefined")) {
                console.log("FAIL: Notification contains 'undefined'. Bug reproduced.");
            } else if (notif.message.includes(`received for ${jobTitle}`)) {
                console.log("SUCCESS: Notification text is correct.");
            } else {
                console.log("WARNING: Notification format unexpected but no 'undefined'.");
            }
        }

    } catch (error) {
        console.error("Error:", error.message);
    }
}

run();
