# Acciones Correctivas

Aplicación local para registrar, analizar y hacer seguimiento de acciones correctivas.

Los registros se guardan en una base de datos SQLite local (`acciones_correctivas.sqlite3`), que no se versiona.

## Ejecutar localmente

```bash
python3 server.py
```

Abre [http://127.0.0.1:8091](http://127.0.0.1:8091).

No requiere dependencias externas: utiliza únicamente la biblioteca estándar de Python.
