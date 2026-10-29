// Guarda cada dato del formulario, incluidas las filas dinámicas creadas por el usuario.
// El HTML expone las funciones y variables usadas aquí en el mismo ámbito global.
window.addEventListener("load", () => {
  const form = document.getElementById("form");
  if (!form) return;

  const feedback = document.getElementById("feedback");
  const saveButton = document.getElementById("save");

  const fieldLabels = {
    proceso: "Área o proceso", origen: "Origen de la situación", situacion: "Descripción del hallazgo",
    fecha_realizacion: "Fecha de identificación", variable5m: "Variable 5M", porque1: "¿Por qué ocurrió? (1)",
    porque2: "¿Por qué? (2)", porque3: "¿Por qué? (3)", porque4: "¿Por qué? (4)",
    similares: "¿Hay antecedentes similares?", causa_validada: "Causa raíz validada", correccion: "Corrección inmediata",
    fecha_correccion: "Fecha de la corrección", evidencia: "Evidencia o vínculo", accion_correctiva: "Acción correctiva",
    responsable: "Responsable", correo_responsable: "Correo del responsable", fecha_propuesta: "Fecha comprometida",
    seguimiento: "Seguimiento y avances", fecha_real_accion: "Fecha real de implementación", eficacia: "Verificación de eficacia",
    observaciones: "Observaciones", matriz_riesgos: "¿Revisar matriz de riesgos?", estado: "Estado",
    correcciones_multiples: "Correcciones inmediatas (detalle)", acciones_multiples: "Acciones correctivas (detalle)",
    analisis_5m: "Análisis 5M (detalle)",
  };
  const textFields = new Set([
    "situacion", "porque1", "porque2", "porque3", "porque4", "causa_validada", "correccion",
    "accion_correctiva", "seguimiento", "eficacia", "observaciones", "evidencia", "correcciones_multiples",
    "acciones_multiples", "analisis_5m",
  ]);
  const fieldOrder = [
    "proceso", "origen", "situacion", "fecha_realizacion",
    "variable5m", "analisis_5m", "porque1", "porque2", "porque3", "porque4", "similares", "causa_validada",
    "correcciones_multiples", "correccion", "fecha_correccion", "evidencia",
    "acciones_multiples", "accion_correctiva", "responsable", "correo_responsable", "fecha_propuesta",
    "seguimiento", "fecha_real_accion", "eficacia", "observaciones", "matriz_riesgos", "estado",
  ];

  function installEditModal() {
    const style = document.createElement("style");
    style.textContent = `
      .record-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(15,35,48,.58)}
      .record-modal.open{display:flex}.record-modal__box{width:min(100%,940px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.3)}
      .record-modal__head{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:16px}.record-modal__head h2{margin:0}.record-modal__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.record-modal__grid label{display:flex;flex-direction:column;gap:6px;font-weight:600}.record-modal__grid input,.record-modal__grid textarea,.record-modal__grid select{font:inherit;padding:9px;border:1px solid #b9cbd5;border-radius:7px}.record-modal__grid textarea{min-height:92px;resize:vertical}.record-modal__wide{grid-column:1 / -1}.record-modal__actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.record-modal__status{margin:12px 0 0;color:#236078}@media(max-width:650px){.record-modal__box{padding:18px}.record-modal__grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);

    const modal = document.createElement("div");
    modal.className = "record-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="record-modal__box"><div class="record-modal__head"><h2 id="recordModalTitle">Editar registro</h2><button type="button" class="secondary" data-close>Cerrar</button></div><form id="recordModalForm"><div class="record-modal__grid" id="recordModalFields"></div><p class="record-modal__status" id="recordModalStatus" role="status"></p><div class="record-modal__actions"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary" id="recordModalSave">Guardar cambios</button></div></form></div>`;
    document.body.append(modal);

    const close = () => modal.classList.remove("open");
    modal.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", close));
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    const modalForm = modal.querySelector("#recordModalForm");
    const modalFields = modal.querySelector("#recordModalFields");
    const modalStatus = modal.querySelector("#recordModalStatus");
    const modalSave = modal.querySelector("#recordModalSave");

    window.editRecord = (id) => {
      const record = records.find((item) => Number(item.id) === Number(id));
      if (!record) return;
      modalForm.dataset.recordId = String(id);
      modal.querySelector("#recordModalTitle").textContent = `Editar registro #${id}`;
      modalStatus.textContent = "Modifique cualquier dato y guarde los cambios.";
      modalFields.replaceChildren();
      const remainingKeys = Object.keys(record).filter((key) => !fieldOrder.includes(key));
      [...fieldOrder, ...remainingKeys]
        .filter((key) => !["id", "creado_en", "actualizado_en"].includes(key) && Object.hasOwn(record, key))
        .map((key) => [key, record[key]])
        .forEach(([key, value]) => {
          const label = document.createElement("label");
          label.textContent = fieldLabels[key] || key.replaceAll("_", " ");
          const isLong = textFields.has(key) || String(value ?? "").length > 90;
          const input = document.createElement(key === "estado" ? "select" : isLong ? "textarea" : "input");
          input.name = key;
          if (key === "estado") {
            const statuses = ["En proceso", "Terminada"];
            if (value && !statuses.includes(value)) statuses.push(value);
            statuses.forEach((status) => {
              const option = document.createElement("option");
              option.value = status;
              option.textContent = status;
              option.selected = status === value;
              input.append(option);
            });
          } else {
            input.value = value ?? "";
            if (!isLong) input.type = key.startsWith("fecha_") ? "date" : key === "correo_responsable" ? "email" : "text";
          }
          if (isLong) label.classList.add("record-modal__wide");
          label.append(input);
          modalFields.append(label);
        });
      modal.classList.add("open");
      modalFields.querySelector("input, textarea")?.focus();
    };

    modalForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = Number(modalForm.dataset.recordId);
      const payload = Object.fromEntries(new FormData(modalForm).entries());
      modalSave.disabled = true;
      modalSave.textContent = "Guardando…";
      modalStatus.textContent = "Guardando todos los cambios en Firestore…";
      try {
        editing = id;
        const savedId = await saveWithTimeout(payload);
        formData = { ...payload, id: savedId };
        document.getElementById("historyArea").value = payload.proceso || "";
        drawRecords();
        close();
        const notice = document.getElementById("storageNotice");
        if (notice) notice.textContent = `Registro #${savedId} actualizado correctamente.`;
      } catch (error) {
        modalStatus.textContent = `No se pudieron guardar los cambios: ${error.message}`;
        modalStatus.style.color = "#a13c33";
      } finally {
        modalSave.disabled = false;
        modalSave.textContent = "Guardar cambios";
      }
    });
  }

  installEditModal();

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
