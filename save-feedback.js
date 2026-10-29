// Replaces the opaque native confirmation with clear validation and save status.
// The HTML exposes these functions and bindings in the same page scope.
window.addEventListener("load", () => {
  const form = document.getElementById("form");
  if (!form) return;

  form.onsubmit = async (event) => {
    event.preventDefault();
    saveCurrent();
    const required = [
      ["proceso", "área o proceso"],
      ["situacion", "descripción del hallazgo"],
      ["fecha_propuesta", "fecha comprometida de la acción"],
      ["correo_responsable", "correo del responsable"],
    ];
    const missing = required
      .filter(([key]) => !String(formData[key] || "").trim())
      .map(([, label]) => label);
    const feedback = document.getElementById("feedback");
    if (missing.length) {
      feedback.textContent = `Para guardar faltan: ${missing.join(", ")}. Revise las etapas anteriores.`;
      feedback.style.color = "#a13c33";
      return;
    }

    const saveButton = document.getElementById("save");
    saveButton.disabled = true;
    saveButton.textContent = "Guardando…";
    feedback.textContent = "Guardando el registro en SQLite…";
    feedback.style.color = "#236078";
    try {
      const payload = { ...formData };
      if (!editing) {
        delete payload.fecha_real_accion;
        delete payload.seguimiento;
      } else if (!String(payload.seguimiento || "").trim()) {
        payload.fecha_real_accion = "";
      }
      if (!String(payload.seguimiento || "").trim()) payload.eficacia = "";
      delete payload.id;
      delete payload.creado_en;
      delete payload.actualizado_en;
      const savedId = await saveRecord(payload);
      document.getElementById("historyArea").value = payload.proceso;
      drawRecords();
      navigate("panel");
      const notice = document.getElementById("storageNotice");
      notice.textContent = `Registro #${savedId} guardado correctamente en SQLite.`;
    } catch (error) {
      feedback.textContent = `No se pudo guardar: ${error.message}`;
      feedback.style.color = "#a13c33";
      saveButton.disabled = false;
      saveButton.textContent = "Guardar registro";
    }
  };
});
