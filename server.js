const nodemailer = require('nodemailer');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./barberia.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        db.run(`
            CREATE TABLE IF NOT EXISTS turnos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT NOT NULL,
                hora TEXT NOT NULL,
                servicio TEXT NOT NULL,
                nombre TEXT NOT NULL,
                telefono TEXT NOT NULL,
                email TEXT,
                UNIQUE(fecha, hora)
            )
        `, (err) => {
            if (err) {
                console.error('Error al crear la tabla turnos:', err.message);
            } else {
                console.log('Tabla "turnos" creada o ya existente.');
            }
        });
    }
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
}
});

// ----------------------
// ENDPOINTS DE LA API
// ----------------------

// GET: Obtener todos los turnos reservados (para el frontend de reservas)
app.get('/api/turnos', (req, res) => {
    db.all('SELECT fecha, hora FROM turnos', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            reservedSlots: rows.map(row => `${row.fecha}-${row.hora}`)
        });
    });
});

// GET: Obtener todos los detalles de los turnos (para el panel de administración)
app.get('/api/admin/turnos', (req, res) => {
    db.all('SELECT id, fecha, hora, servicio, nombre, telefono, email FROM turnos ORDER BY fecha ASC, hora ASC', [], (err, rows) => {
        if (err) {
            console.error('Error al obtener todos los turnos para administración:', err.message);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ turnos: rows });
    });
});

// DELETE: Eliminar un turno por su ID
app.delete('/api/admin/turnos/:id', (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM turnos WHERE id = ?', id, function (err) {
        if (err) {
            console.error('Error al eliminar el turno:', err.message);
            return res.status(500).json({ error: 'Error interno del servidor al eliminar el turno: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: 'Turno no encontrado.' });
        }
        console.log(`Turno con ID ${id} eliminado correctamente.`);
        res.status(200).json({ message: 'Turno eliminado con éxito.' });
    });
});


// POST: Reservar un nuevo turno
app.post('/api/turnos', (req, res) => {
    const { fecha, hora, servicio, nombre, telefono, email } = req.body;

    if (!fecha || !hora || !servicio || !nombre || !telefono) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para la reserva.' });
    }

    db.run(`INSERT INTO turnos (fecha, hora, servicio, nombre, telefono, email) VALUES (?, ?, ?, ?, ?, ?)`,
        [fecha, hora, servicio, nombre, telefono, email],
        function (err) {
            if (err) {
                if (err.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed')) {
                    return res.status(409).json({ error: 'El turno seleccionado ya está reservado. Por favor, elige otro.' });
                }
                console.error('Error al insertar turno en la base de datos:', err.message);
                return res.status(500).json({ error: 'Error interno del servidor al intentar reservar: ' + err.message });
            }

            console.log(`Nuevo turno reservado (ID: ${this.lastID}): ${nombre} - ${fecha} ${hora}`);

            console.log('Intentando enviar correo de notificación...'); // Para depuración

            const mailOptions = {
                from: 'mateosbarber359@gmail.com', // ¡TU CORREO DE GMAIL AQUÍ!
                to: 'mateosbarber359@gmail.com', // ¡CORREO AL QUE QUIERES RECIBIR LAS NOTIFICACIONES!
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
                turnoId: this.lastID,
                details: { fecha, hora, servicio, nombre, telefono, email }
            });
        }
    );
});

app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
    console.log(`API de turnos disponible en http://localhost:${PORT}/api/turnos`);
});