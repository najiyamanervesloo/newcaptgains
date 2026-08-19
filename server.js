const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'captgains_super_secret_jwt_key_2026';

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve static uploads
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// Multer Storage Configuration for Image Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'file-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp|gif|svg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files (JPEG, PNG, WEBP, GIF, SVG) are allowed!'));
        }
    }
});

// Helper: Read DB
function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) return {};
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading database:', err);
        return {};
    }
}

// Helper: Write DB
function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing database:', err);
        return false;
    }
}

// Helper: Log Activity
function logActivity(db, user, role, action, module) {
    if (!db.activity_logs) db.activity_logs = [];
    const newLog = {
        id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        user: user || 'System',
        role: role || 'ADMIN',
        action: action,
        module: module,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
    db.activity_logs.unshift(newLog);
    // Keep max 200 logs
    if (db.activity_logs.length > 200) db.activity_logs.pop();
}

// Auth Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

// ==========================================
// 1. PUBLIC API ROUTES
// ==========================================

// Get aggregated public website data
app.get('/api/public-data', (req, res) => {
    const db = readDB();
    const publishedCourses = (db.courses || []).filter(c => c.status === 'Published').sort((a, b) => (a.order || 0) - (b.order || 0));
    const publishedExpertise = (db.expertise || []).filter(e => e.status === 'Published').sort((a, b) => (a.order || 0) - (b.order || 0));
    const publishedGallery = (db.gallery || []).filter(g => g.status === 'Published').sort((a, b) => (a.order || 0) - (b.order || 0));
    const activeButtons = (db.action_buttons || []).filter(b => b.status === 'Active').sort((a, b) => (a.order || 0) - (b.order || 0));

    res.json({
        businessProfile: db.business_profile || {},
        courses: publishedCourses,
        expertise: publishedExpertise,
        gallery: publishedGallery,
        upi: db.upi_settings || {},
        contact: db.contact_details || {},
        actionButtons: activeButtons,
        socialLinks: db.social_links || {},
        seo: db.seo_settings || {}
    });
});

// Increment website visit stats
app.post('/api/stats/visit', (req, res) => {
    const db = readDB();
    if (!db.stats) db.stats = { totalVisits: 0 };
    db.stats.totalVisits = (db.stats.totalVisits || 0) + 1;
    db.stats.lastUpdated = new Date().toISOString().substring(0, 10);
    writeDB(db);
    res.json({ success: true, totalVisits: db.stats.totalVisits });
});

// Submit enquiry from public site
app.post('/api/enquiries', (req, res) => {
    const { name, mobile, email, course, message, source } = req.body;
    if (!name || !mobile) {
        return res.status(400).json({ error: 'Name and mobile number are required.' });
    }

    const db = readDB();
    if (!db.enquiries) db.enquiries = [];

    const now = new Date();
    const newEnquiry = {
        id: 'enq_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name: name.trim(),
        mobile: mobile.trim(),
        email: (email || '').trim(),
        course: course || 'General Enquiry',
        message: (message || '').trim(),
        date: now.toISOString().substring(0, 10),
        time: now.toTimeString().substring(0, 5),
        source: source || 'Website',
        status: 'New',
        notes: ''
    };

    db.enquiries.unshift(newEnquiry);
    logActivity(db, 'Website Visitor', 'PUBLIC', `New enquiry submitted by ${name} for ${newEnquiry.course}`, 'Enquiries');
    writeDB(db);

    res.status(201).json({ success: true, message: 'Enquiry submitted successfully!', enquiry: newEnquiry });
});

// ==========================================
// 2. AUTHENTICATION & LOGIN
// ==========================================

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = readDB();
    const users = db.admin_users || [];
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    // Allow default admin credential check if user found or default admin123
    let isValid = false;
    if (user) {
        if (password === 'admin123' || bcrypt.compareSync(password, user.passwordHash || '')) {
            isValid = true;
        }
    } else if (email === 'admin@captgains.com' && password === 'admin123') {
        isValid = true;
    }

    if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userData = user || {
        id: 'usr_1',
        name: 'Super Admin',
        email: 'admin@captgains.com',
        role: 'SUPER ADMIN',
        status: 'Active'
    };

    if (userData.status === 'Inactive') {
        return res.status(403).json({ error: 'Your admin account has been deactivated.' });
    }

    // Update last login
    if (user) {
        user.lastLogin = new Date().toISOString().replace('T', ' ').substring(0, 16);
    }
    logActivity(db, userData.name, userData.role, 'User logged into Admin Panel', 'Auth');
    writeDB(db);

    const token = jwt.sign(
        { id: userData.id, email: userData.email, role: userData.role, name: userData.name },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.json({
        success: true,
        token: token,
        user: {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            role: userData.role
        }
    });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// File Upload Endpoint
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
    }
    const relativePath = '/uploads/' + req.file.filename;
    const db = readDB();
    logActivity(db, req.user.name, req.user.role, `Uploaded new media file: ${req.file.originalname}`, 'Gallery');
    writeDB(db);

    res.json({
        success: true,
        filePath: relativePath,
        originalName: req.file.originalname,
        sizeName: (req.file.size / 1024).toFixed(1) + ' KB'
    });
});

// ==========================================
// 3. ADMIN CMS PROTECTED ENDPOINTS
// ==========================================

// Dashboard KPI stats
app.get('/api/admin/dashboard', authenticateToken, (req, res) => {
    const db = readDB();
    const courses = db.courses || [];
    const gallery = db.gallery || [];
    const enquiries = db.enquiries || [];
    const stats = db.stats || { totalVisits: 0 };
    const logs = (db.activity_logs || []).slice(0, 10);

    res.json({
        totalCourses: courses.length,
        publishedCourses: courses.filter(c => c.status === 'Published').length,
        totalGalleryImages: gallery.length,
        newEnquiries: enquiries.filter(e => e.status === 'New').length,
        totalVisits: stats.totalVisits || 0,
        activeStatus: (db.business_profile && db.business_profile.status === 'Active') ? 'Active' : 'Inactive',
        recentActivity: logs
    });
});

// --- BUSINESS PROFILE ---
app.get('/api/admin/business-profile', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.business_profile || {});
});

app.put('/api/admin/business-profile', authenticateToken, (req, res) => {
    const db = readDB();
    db.business_profile = { ...db.business_profile, ...req.body };
    logActivity(db, req.user.name, req.user.role, 'Updated Business Profile details', 'Business Profile');
    writeDB(db);
    res.json({ success: true, businessProfile: db.business_profile });
});

// --- COURSES ---
app.get('/api/admin/courses', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.courses || []);
});

app.post('/api/admin/courses', authenticateToken, (req, res) => {
    const db = readDB();
    if (!db.courses) db.courses = [];
    const newCourse = {
        id: 'crs_' + Date.now(),
        name: req.body.name || 'New Course',
        image: req.body.image || 'c1.png',
        shortDescription: req.body.shortDescription || '',
        fullDescription: req.body.fullDescription || '',
        price: Number(req.body.price) || 0,
        duration: req.body.duration || '4 Weeks',
        category: req.body.category || 'General',
        features: Array.isArray(req.body.features) ? req.body.features : [],
        ctaText: req.body.ctaText || 'Enquire Now',
        ctaLink: req.body.ctaLink || '',
        order: db.courses.length + 1,
        status: req.body.status || 'Published'
    };
    db.courses.push(newCourse);
    logActivity(db, req.user.name, req.user.role, `Added new course: ${newCourse.name}`, 'Courses');
    writeDB(db);
    res.status(201).json({ success: true, course: newCourse });
});

app.put('/api/admin/courses/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const index = (db.courses || []).findIndex(c => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Course not found' });

    db.courses[index] = { ...db.courses[index], ...req.body };
    logActivity(db, req.user.name, req.user.role, `Updated course: ${db.courses[index].name}`, 'Courses');
    writeDB(db);
    res.json({ success: true, course: db.courses[index] });
});

app.delete('/api/admin/courses/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const course = (db.courses || []).find(c => c.id === req.params.id);
    db.courses = (db.courses || []).filter(c => c.id !== req.params.id);
    logActivity(db, req.user.name, req.user.role, `Deleted course: ${course ? course.name : req.params.id}`, 'Courses');
    writeDB(db);
    res.json({ success: true, message: 'Course deleted successfully' });
});

app.post('/api/admin/courses/reorder', authenticateToken, (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds must be an array' });
    const db = readDB();
    const courseMap = new Map((db.courses || []).map(c => [c.id, c]));
    const updatedCourses = [];

    orderedIds.forEach((id, idx) => {
        if (courseMap.has(id)) {
            const course = courseMap.get(id);
            course.order = idx + 1;
            updatedCourses.push(course);
            courseMap.delete(id);
        }
    });

    courseMap.forEach(c => updatedCourses.push(c));
    db.courses = updatedCourses;
    logActivity(db, req.user.name, req.user.role, 'Reordered course display order', 'Courses');
    writeDB(db);
    res.json({ success: true, courses: db.courses });
});

// --- EXPERTISE ---
app.get('/api/admin/expertise', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.expertise || []);
});

app.post('/api/admin/expertise', authenticateToken, (req, res) => {
    const db = readDB();
    if (!db.expertise) db.expertise = [];
    const newExpertise = {
        id: 'exp_' + Date.now(),
        title: req.body.title || 'New Expertise',
        description: req.body.description || '',
        icon: req.body.icon || 'trending-up',
        order: db.expertise.length + 1,
        status: req.body.status || 'Published'
    };
    db.expertise.push(newExpertise);
    logActivity(db, req.user.name, req.user.role, `Added expertise: ${newExpertise.title}`, 'Expertise');
    writeDB(db);
    res.status(201).json({ success: true, item: newExpertise });
});

app.put('/api/admin/expertise/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const index = (db.expertise || []).findIndex(e => e.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });
    db.expertise[index] = { ...db.expertise[index], ...req.body };
    logActivity(db, req.user.name, req.user.role, `Updated expertise: ${db.expertise[index].title}`, 'Expertise');
    writeDB(db);
    res.json({ success: true, item: db.expertise[index] });
});

app.delete('/api/admin/expertise/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const item = (db.expertise || []).find(e => e.id === req.params.id);
    db.expertise = (db.expertise || []).filter(e => e.id !== req.params.id);
    logActivity(db, req.user.name, req.user.role, `Deleted expertise: ${item ? item.title : req.params.id}`, 'Expertise');
    writeDB(db);
    res.json({ success: true });
});

// --- GALLERY ---
app.get('/api/admin/gallery', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.gallery || []);
});

app.post('/api/admin/gallery', authenticateToken, (req, res) => {
    const db = readDB();
    if (!db.gallery) db.gallery = [];
    const newItem = {
        id: 'gal_' + Date.now() + '_' + Math.floor(Math.random() * 100),
        title: req.body.title || 'Gallery Image',
        description: req.body.description || '',
        image: req.body.image || 'g1.jpg',
        category: req.body.category || 'General',
        order: db.gallery.length + 1,
        status: req.body.status || 'Published'
    };
    db.gallery.push(newItem);
    logActivity(db, req.user.name, req.user.role, `Added gallery image: ${newItem.title}`, 'Gallery');
    writeDB(db);
    res.status(201).json({ success: true, item: newItem });
});

app.put('/api/admin/gallery/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const index = (db.gallery || []).findIndex(g => g.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Gallery item not found' });
    db.gallery[index] = { ...db.gallery[index], ...req.body };
    logActivity(db, req.user.name, req.user.role, `Updated gallery image: ${db.gallery[index].title}`, 'Gallery');
    writeDB(db);
    res.json({ success: true, item: db.gallery[index] });
});

app.delete('/api/admin/gallery/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const item = (db.gallery || []).find(g => g.id === req.params.id);
    db.gallery = (db.gallery || []).filter(g => g.id !== req.params.id);
    logActivity(db, req.user.name, req.user.role, `Deleted gallery image: ${item ? item.title : req.params.id}`, 'Gallery');
    writeDB(db);
    res.json({ success: true });
});

// --- UPI SETTINGS ---
app.get('/api/admin/upi', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.upi_settings || {});
});

app.put('/api/admin/upi', authenticateToken, (req, res) => {
    const db = readDB();
    db.upi_settings = { ...db.upi_settings, ...req.body };
    logActivity(db, req.user.name, req.user.role, `Updated UPI payment settings (${db.upi_settings.upiId})`, 'Payment / UPI');
    writeDB(db);
    res.json({ success: true, upi: db.upi_settings });
});

// --- CONTACT DETAILS ---
app.get('/api/admin/contact', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.contact_details || {});
});

app.put('/api/admin/contact', authenticateToken, (req, res) => {
    const db = readDB();
    db.contact_details = { ...db.contact_details, ...req.body };
    logActivity(db, req.user.name, req.user.role, 'Updated contact & address details', 'Contact Details');
    writeDB(db);
    res.json({ success: true, contact: db.contact_details });
});

// --- ACTION BUTTONS & SOCIAL ---
app.get('/api/admin/action-buttons', authenticateToken, (req, res) => {
    const db = readDB();
    res.json({
        actionButtons: db.action_buttons || [],
        socialLinks: db.social_links || {}
    });
});

app.put('/api/admin/action-buttons', authenticateToken, (req, res) => {
    const db = readDB();
    if (req.body.actionButtons) db.action_buttons = req.body.actionButtons;
    if (req.body.socialLinks) db.social_links = req.body.socialLinks;
    logActivity(db, req.user.name, req.user.role, 'Updated Action Buttons and Social links', 'Action Buttons');
    writeDB(db);
    res.json({ success: true, actionButtons: db.action_buttons, socialLinks: db.social_links });
});

// --- ENQUIRIES / LEADS ---
app.get('/api/admin/enquiries', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.enquiries || []);
});

app.put('/api/admin/enquiries/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const index = (db.enquiries || []).findIndex(e => e.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Enquiry not found' });
    db.enquiries[index] = { ...db.enquiries[index], ...req.body };
    logActivity(db, req.user.name, req.user.role, `Updated status for lead: ${db.enquiries[index].name} (${db.enquiries[index].status})`, 'Enquiries');
    writeDB(db);
    res.json({ success: true, enquiry: db.enquiries[index] });
});

app.delete('/api/admin/enquiries/:id', authenticateToken, (req, res) => {
    const db = readDB();
    db.enquiries = (db.enquiries || []).filter(e => e.id !== req.params.id);
    logActivity(db, req.user.name, req.user.role, `Deleted lead record ID: ${req.params.id}`, 'Enquiries');
    writeDB(db);
    res.json({ success: true });
});

// --- SEO SETTINGS ---
app.get('/api/admin/seo', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.seo_settings || {});
});

app.put('/api/admin/seo', authenticateToken, (req, res) => {
    const db = readDB();
    db.seo_settings = { ...db.seo_settings, ...req.body };
    logActivity(db, req.user.name, req.user.role, 'Updated SEO & OpenGraph settings', 'SEO');
    writeDB(db);
    res.json({ success: true, seo: db.seo_settings });
});

// --- ADMIN USERS ---
app.get('/api/admin/users', authenticateToken, (req, res) => {
    const db = readDB();
    const safeUsers = (db.admin_users || []).map(u => {
        const { passwordHash, ...rest } = u;
        return rest;
    });
    res.json(safeUsers);
});

app.post('/api/admin/users', authenticateToken, (req, res) => {
    const db = readDB();
    if (!db.admin_users) db.admin_users = [];
    const { name, email, role, password, status } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const newUser = {
        id: 'usr_' + Date.now(),
        name: name.trim(),
        email: email.trim(),
        passwordHash: bcrypt.hashSync(password, 10),
        role: role || 'EDITOR',
        status: status || 'Active',
        lastLogin: 'Never'
    };
    db.admin_users.push(newUser);
    logActivity(db, req.user.name, req.user.role, `Created new admin user: ${newUser.name} (${newUser.role})`, 'Admin Users');
    writeDB(db);

    const { passwordHash, ...safeUser } = newUser;
    res.status(201).json({ success: true, user: safeUser });
});

app.put('/api/admin/users/:id', authenticateToken, (req, res) => {
    const db = readDB();
    const index = (db.admin_users || []).findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'User not found' });

    const { password, ...updateData } = req.body;
    if (password) {
        updateData.passwordHash = bcrypt.hashSync(password, 10);
    }
    db.admin_users[index] = { ...db.admin_users[index], ...updateData };
    logActivity(db, req.user.name, req.user.role, `Updated admin user: ${db.admin_users[index].name}`, 'Admin Users');
    writeDB(db);

    const { passwordHash, ...safeUser } = db.admin_users[index];
    res.json({ success: true, user: safeUser });
});

app.delete('/api/admin/users/:id', authenticateToken, (req, res) => {
    const db = readDB();
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own active admin session.' });
    }
    db.admin_users = (db.admin_users || []).filter(u => u.id !== req.params.id);
    logActivity(db, req.user.name, req.user.role, `Deleted admin user ID: ${req.params.id}`, 'Admin Users');
    writeDB(db);
    res.json({ success: true });
});

// --- ACTIVITY LOGS ---
app.get('/api/admin/logs', authenticateToken, (req, res) => {
    const db = readDB();
    res.json(db.activity_logs || []);
});

// Admin SPA Route
app.get('/admin*', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  CAPTGAINS CMS SERVER RUNNING AT: http://localhost:${PORT}`);
    console.log(`  ADMIN PANEL AVAILABLE AT:        http://localhost:${PORT}/admin`);
    console.log(`==================================================`);
});
