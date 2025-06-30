const nodemailer = require('nodemailer');
const express = require('express');
const { Pool } = require('pg'); // Importa Pool de 'pg'
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Usa process.env.PORT para Render

app.use(cors());
app.use(express.json());

// --- Configuración de PostgreSQL ---
// Render automáticamente provee DATABASE_URL para tus servicios web
// si la DB está en la misma cuenta de Render.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Importante para conexiones en Render si no tienes un certificado configurado
    }
});

// Conectar y crear la tabla si no existe
pool.query(`
    CREATE TABLE IF NOT EXISTS turnos (
        id SERIAL PRIMARY KEY,
        fecha TEXT NOT NULL,
        hora TEXT NOT NULL,
        servicio TEXT NOT NULL,
        nombre TEXT NOT NULL,
        telefono TEXT NOT NULL,
        email TEXT,
        UNIQUE(fecha, hora)
    )
`, (err, res) => {
    if (err) {
        console.error('Error al crear la tabla turnos en PostgreSQL:', err.message);
    } else {
        console.log('Tabla "turnos" creada o ya existente en PostgreSQL.');
    }
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER, // Lee de variables de entorno
        pass: process.env.GMAIL_PASS  // Lee de variables de entorno
    }
});

// ----------------------
// ENDPOINTS DE LA API
// ----------------------

// GET: Obtener todos los turnos reservados (para el frontend de reservas)
app.get('/api/turnos', async (req, res) => {
    try {
        const result = await pool.query('SELECT fecha, hora FROM turnos');
        res.json({
            reservedSlots: result.rows.map(row => `${row.fecha}-${row.hora}`)
        });
    } catch (err) {
        console.error('Error al obtener turnos de PostgreSQL:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET: Obtener todos los detalles de los turnos (para el panel de administración)
app.get('/api/admin/turnos', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, fecha, hora, servicio, nombre, telefono, email FROM turnos ORDER BY fecha ASC, hora ASC');
        res.json({ turnos: result.rows });
    } catch (err) {
        console.error('Error al obtener todos los turnos para administración desde PostgreSQL:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Eliminar un turno por su ID
app.delete('/api/admin/turnos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM turnos WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Turno no encontrado.' });
        }
        console.log(`Turno con ID ${id} eliminado correctamente.`);
        res.status(200).json({ message: 'Turno eliminado con éxito.' });
    } catch (err) {
        console.error('Error al eliminar el turno en PostgreSQL:', err.message);
        return res.status(500).json({ error: 'Error interno del servidor al eliminar el turno: ' + err.message });
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
        const lastID = result.rows[0].id; // Obtiene el ID insertado

        console.log(`Nuevo turno reservado (ID: ${lastID}): ${nombre} - ${fecha} ${hora}`);

        const mailOptions = {
            from: process.env.GMAIL_USER,
            to: process.env.GMAIL_USER, // Puedes poner otro correo aquí si prefieres
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

        res.status(201).json({
            message: '¡Turno reservado con éxito!',
            turnoId: lastID,
            details: { fecha, hora, servicio, nombre, telefono, email }
        });

    } catch (err) {
        if (err.code === '23505') { // Código de error para violaciones de unicidad en PostgreSQL
            return res.status(409).json({ error: 'El turno seleccionado ya está reservado. Por favor, elige otro.' });
        }
        console.error('Error al insertar turno en PostgreSQL:', err.message);
        return res.status(500).json({ error: 'Error interno del servidor al intentar reservar: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
    console.log(`API de turnos disponible en http://localhost:${PORT}/api/turnos`);
});