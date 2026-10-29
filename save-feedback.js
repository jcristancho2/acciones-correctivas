// Guarda cada dato del formulario, incluidas las filas dinámicas creadas por el usuario.
// El HTML expone las funciones y variables usadas aquí en el mismo ámbito global.
window.addEventListener("load", () => {
  const form = document.getElementById("form");
  if (!form) return;

  const feedback = document.getElementById("feedback");
  const saveButton = document.getElementById("save");

  function captureAll() {
    saveCurrent();
    // Las filas dinámicas pueden haber sido creadas después de cargar la etapa.
    if (document.getElementById("correctionRows")) storeCorrections();
    if (document.getElementById("actionRows")) storeActions();
  }

  function saveWithTimeout(payload) {
    // Las instancias gratuitas de Render pueden despertarse después de varios
    // segundos de inactividad. Abortamos solo tras un margen realista y con un
    // mensaje que explique qué está ocurriendo.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    const wakingUp = window.setTimeout(() => {
      if (saveButton.disabled) {
        feedback.textContent = "El servicio se está activando. Conservamos el formulario y seguimos intentando guardar…";
      }
    }, 12000);

    return saveRecord(payload, controller.signal).finally(() => {
      window.clearTimeout(timeout);
      window.clearTimeout(wakingUp);
    });
  }

  // Conserva el dato que se está editando aun antes de pasar a la siguiente etapa.
  form.addEventListener("input", captureAll);
  form.addEventListener("change", captureAll);

  form.onsubmit = async (event) => {
    event.preventDefault();
    captureAll();

    const required = [
      ["proceso", "área o proceso"],
      ["situacion", "descripción del hallazgo"],
      ["fecha_propuesta", "fecha comprometida de la acción"],
      ["correo_responsable", "correo del responsable"],
    ];
    const missing = required
      .filter(([key]) => !String(formData[key] || "").trim())
      .map(([, label]) => label);
    if (missing.length) {
      feedback.textContent = `Para guardar faltan: ${missing.join(", ")}. Revise las etapas anteriores.`;
      feedback.style.color = "#a13c33";
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Guardando…";
    feedback.textContent = "Guardando toda la información del registro…";
    feedback.style.color = "#236078";

    try {
      const payload = { ...formData };
      // Solo se eliminan metadatos del servidor: los datos diligenciados se conservan.
      delete payload.id;
      delete payload.creado_en;
      delete payload.actualizado_en;

      const savedId = await saveWithTimeout(payload);
      document.getElementById("historyArea").value = payload.proceso;
      drawRecords();
      navigate("panel");
      const notice = document.getElementById("storageNotice");
      notice.textContent = `Registro #${savedId} guardado correctamente con todas sus etapas.`;
    } catch (error) {
      const message = error.name === "AbortError"
        ? "El servicio no respondió en 90 segundos. El formulario permanece diligenciado; intente guardar otra vez."
        : error.message;
      feedback.textContent = `No se pudo guardar: ${message}`;
      feedback.style.color = "#a13c33";
      saveButton.disabled = false;
      saveButton.textContent = "Guardar registro";
    }
  };
});
