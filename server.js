const nodemailer = require('nodemailer');
const express = require('express');
const { Pool } = require('pg'); // CAMBIO CLAVE: Usamos 'pg' para PostgreSQL
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para habilitar CORS para todas las solicitudes
app.use(cors());

// Middleware para parsear el cuerpo de las solicitudes JSON
app.use(express.json());

// ----------------------------------------------------
// CAMBIO CLAVE: Conexión a la base de datos PostgreSQL
// Usamos DATABASE_URL de las variables de entorno de Render
// ----------------------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Render inyecta esta URL
    ssl: {
        rejectUnauthorized: false // NECESARIO para conexiones SSL en Render
    }
});

// Verificación de conexión a la base de datos
pool.on('connect', () => {
    console.log('Conectado a la base de datos PostgreSQL.');
});

pool.on('error', (err) => {
    console.error('Error inesperado en el cliente de PostgreSQL:', err);
});

// Función para asegurar que la tabla 'turnos' existe en PostgreSQL
async function createTurnosTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS turnos (
                id SERIAL PRIMARY KEY,
                fecha TEXT NOT NULL,
                hora TEXT NOT NULL,
                servicio TEXT NOT NULL,
                nombre TEXT NOT NULL,
                telefono TEXT NOT NULL,
                email TEXT,
                UNIQUE(fecha, hora)
            );
        `);
        console.log('Tabla "turnos" creada o ya existente en PostgreSQL.');
    } catch (err) {
        console.error('Error al crear la tabla turnos en PostgreSQL:', err.stack);
    }
}

// Llama a la función al iniciar la aplicación
createTurnosTable();

// Configuración del transportador de Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'mateosbarber359@gmail.com', // ¡TU CORREO DE GMAIL AQUÍ!
        pass: 'uzvu tgug snjg bgas' // ¡TU CONTRASEÑA DE APLICACIÓN DE 16 CARACTERES AQUÍ!
    }
});

// ----------------------
// ENDPOINTS DE LA API
// ----------------------

// GET: Obtener todos los turnos reservados (para la vista pública del calendario)
app.get('/api/turnos', async (req, res) => {
    try {
        const result = await pool.query('SELECT fecha, hora FROM turnos');
        res.json({
            reservedSlots: result.rows.map(row => `${row.fecha}-${row.hora}`)
        });
    } catch (err) {
        console.error('Error al obtener turnos públicos:', err.stack);
        res.status(500).json({ error: err.message });
    }
});

// POST: Reservar un nuevo turno
app.post('/api/turnos', async (req, res) => {
    const { fecha, hora, servicio, nombre, telefono, email } = req.body;

    if (!fecha || !hora || !servicio || !nombre || !telefono) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO turnos (fecha, hora, servicio, nombre, telefono, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [fecha, hora, servicio, nombre, telefono, email]
        );

        const newTurnoId = result.rows[0].id;
        console.log(`Nuevo turno reservado (ID: ${newTurnoId}): ${nombre} - ${fecha} ${hora}`);

        // LÓGICA PARA ENVIAR CORREO DE NOTIFICACIÓN
        const mailOptions = {
            from: 'mateosbarber359@gmail.com',
            to: 'mateosbarber359@gmail.com',
            subject: '¡Nueva Reserva en Mateo\'s Barber!',
            html: `
                <p>¡Hola Barbero!</p>
                <p>Se ha realizado una nueva reserva en tu barbería:</p>
                <ul>
                    <li><strong>Nombre:</strong> ${nombre}</li>
                    <li><strong>Teléfono:</strong> ${telefono}</li>
                    <li><strong>Email:</strong> ${email || 'No proporcionado'}</li>
                    <li><strong>Servicio:</strong> ${servicio}</li>
                    <li><strong>Fecha:</strong> ${fecha}</li>
                    <li><strong>Hora:</strong> ${hora}</li>
                </ul>
                <p>¡Que tengas un buen día!</p>
                <p>Sistema de Reservas de Mateo's Barber</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error al enviar el correo de notificación:', error);
            } else {
                console.log('Correo de notificación enviado:', info.response);
            }
        });
        // FIN LÓGICA DE CORREO

        res.status(201).json({
            message: '¡Turno reservado con éxito!',
            turnoId: newTurnoId,
            details: { fecha, hora, servicio, nombre, telefono, email }
        });

    } catch (err) {
        if (err.code === '23505' && err.constraint === 'turnos_fecha_hora_key') { // Código de error para UNIQUE constraint violation en PostgreSQL
            return res.status(409).json({ error: 'El turno seleccionado ya está reservado. Por favor, elige otro.' });
        }
        console.error('Error al insertar turno en la base de datos:', err.stack);
        res.status(500).json({ error: 'Error interno del servidor al intentar reservar: ' + err.message });
    }
});

// **********************************************
// RUTAS DE ADMINISTRACIÓN (PROTEGIDAS)
// **********************************************

// Middleware de autenticación para rutas de administrador
function authenticateAdmin(req, res, next) {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Acceso no autorizado. Credenciales de administrador incorrectas.' });
    }
    next(); // Si la clave es correcta, continúa con la siguiente función (la ruta)
}

// GET: Obtener todos los turnos con todos los detalles (PROTEGIDA)
app.get('/api/admin/turnos', authenticateAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, fecha, hora, servicio, nombre, telefono, email FROM turnos ORDER BY fecha, hora');
        res.status(200).json(result.rows); // Devuelve directamente el array de filas
    } catch (error) {
        console.error('Error al obtener todos los turnos para administración:', error.stack);
        res.status(500).json({ error: 'Error interno del servidor al obtener turnos para administración.' });
    }
});

// DELETE: Eliminar un turno por ID (PROTEGIDA)
app.delete('/api/admin/turnos/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM turnos WHERE id = $1 RETURNING id', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Turno no encontrado.' });
        }
        res.status(200).json({ message: 'Turno eliminado con éxito.', idEliminado: id });

    } catch (error) {
        console.error('Error al eliminar el turno:', error.stack);
        res.status(500).json({ error: 'Error interno del servidor al eliminar el turno.' });
    }
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
    console.log(`API de turnos (pública) disponible en http://localhost:${PORT}/api/turnos`);
    console.log(`API de turnos (admin) disponible en http://localhost:${PORT}/api/admin/turnos`);
});