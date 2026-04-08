document.addEventListener('DOMContentLoaded', () => {
    const invalidClass = 'admin-invalid';

    const uniqueMessages = (messages) => [...new Set(messages.filter(Boolean))];

    const showErrors = (form, messages) => {
        const container = form.querySelector('[data-form-errors]');
        if (!container) {
            return;
        }
        if (!messages.length) {
            container.textContent = '';
            container.classList.add('hidden');
            return;
        }
        container.innerHTML = `<ul class="list-disc pl-5 space-y-1">${messages.map((message) => `<li>${message}</li>`).join('')}</ul>`;
        container.classList.remove('hidden');
    };

    const toggleUploadZoneState = (field, isInvalid) => {
        const zoneId = field.dataset.uploadZoneId;
        if (!zoneId) {
            return;
        }
        const zone = document.getElementById(zoneId);
        if (!zone) {
            return;
        }
        zone.classList.toggle(invalidClass, isInvalid);
        zone.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
    };

    const clearInvalidState = (field) => {
        field.classList.remove(invalidClass);
        field.removeAttribute('aria-invalid');
        toggleUploadZoneState(field, false);
    };

    const setInvalidState = (field) => {
        field.classList.add(invalidClass);
        field.setAttribute('aria-invalid', 'true');
        toggleUploadZoneState(field, true);
    };

    const validateField = (field, fields = []) => {
        if (!field || field.disabled) {
            return null;
        }

        clearInvalidState(field);
        const requiredMessage = field.dataset.requiredMessage || `${field.name || 'This field'} is required.`;

        if (field.type === 'radio') {
            const radioGroup = fields.filter((candidate) => candidate.type === 'radio' && candidate.name === field.name);
            radioGroup.forEach((radio) => clearInvalidState(radio));
            if (field.required && !radioGroup.some((radio) => radio.checked)) {
                radioGroup.forEach((radio) => setInvalidState(radio));
                return requiredMessage;
            }
            return null;
        }

        if (field.type === 'file') {
            const selectedFile = field.files && field.files[0];
            if (field.required && !selectedFile) {
                setInvalidState(field);
                return requiredMessage;
            }
            if (!selectedFile) {
                return null;
            }

            const maxFileMb = Number(field.dataset.maxFileMb || 0);
            if (maxFileMb && selectedFile.size > maxFileMb * 1024 * 1024) {
                setInvalidState(field);
                return `File must be ${maxFileMb}MB or less.`;
            }

            const acceptedTypes = (field.getAttribute('accept') || '')
                .split(',')
                .map((item) => item.trim().toLowerCase())
                .filter(Boolean);

            if (acceptedTypes.length) {
                const fileName = selectedFile.name.toLowerCase();
                const fileType = (selectedFile.type || '').toLowerCase();
                const isAccepted = acceptedTypes.some((rule) => {
                    if (rule.startsWith('.')) {
                        return fileName.endsWith(rule);
                    }
                    if (rule.endsWith('/*')) {
                        return fileType.startsWith(rule.slice(0, -1));
                    }
                    return fileType === rule;
                });

                if (!isAccepted) {
                    setInvalidState(field);
                    return field.dataset.fileMessage || 'Choose a supported file type.';
                }
            }

            return null;
        }

        const value = typeof field.value === 'string' ? field.value.trim() : '';

        if (field.hasAttribute('required') && !value) {
            setInvalidState(field);
            return requiredMessage;
        }

        if (field.dataset.slugField === 'true' && value) {
            const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
            if (!slugRegex.test(value)) {
                setInvalidState(field);
                return field.title || 'Use lowercase letters, numbers, and hyphens only.';
            }
        }

        if (field.dataset.urlField === 'true' && value) {
            try {
                new URL(value);
            } catch (error) {
                setInvalidState(field);
                return field.dataset.urlMessage || 'Enter a valid URL.';
            }
        }

        if (field.dataset.jsonField === 'true' && value) {
            try {
                JSON.parse(value);
            } catch (error) {
                setInvalidState(field);
                return field.dataset.jsonMessage || 'Enter valid JSON.';
            }
        }

        if (field.type === 'number' && value) {
            const numericValue = Number(value);
            const min = field.getAttribute('min');
            const max = field.getAttribute('max');
            if (min !== null && numericValue < Number(min)) {
                setInvalidState(field);
                return `Value must be at least ${min}.`;
            }
            if (max !== null && numericValue > Number(max)) {
                setInvalidState(field);
                return `Value must be ${max} or less.`;
            }
        }

        if (typeof field.checkValidity === 'function' && !field.checkValidity()) {
            setInvalidState(field);
            return field.validationMessage || requiredMessage;
        }

        return null;
    };

    document.querySelectorAll('[data-validate-form]').forEach((form) => {
        form.setAttribute('novalidate', 'novalidate');
        const fields = Array.from(form.querySelectorAll('input, select, textarea')).filter((field) => field.type !== 'hidden' && field.type !== 'submit' && field.type !== 'button');

        const runValidation = () => {
            const errors = uniqueMessages(fields.map((field) => validateField(field, fields)));
            showErrors(form, errors);
            return errors;
        };

        fields.forEach((field) => {
            const validateCurrentForm = () => runValidation();
            field.addEventListener('input', validateCurrentForm);
            field.addEventListener('change', validateCurrentForm);
        });

        form.addEventListener('submit', (event) => {
            const errors = runValidation();
            if (errors.length) {
                event.preventDefault();
                const firstInvalidField = fields.find((field) => field.classList.contains(invalidClass));
                if (firstInvalidField) {
                    if (firstInvalidField.type === 'file') {
                        const zone = firstInvalidField.dataset.uploadZoneId ? document.getElementById(firstInvalidField.dataset.uploadZoneId) : null;
                        zone?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        firstInvalidField.focus();
                        firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        });
    });

    document.querySelectorAll('input[type="file"][data-upload-zone-id]').forEach((input) => {
        const zone = document.getElementById(input.dataset.uploadZoneId);
        const fileNameTarget = input.dataset.fileNameTarget ? document.getElementById(input.dataset.fileNameTarget) : null;
        const defaultText = fileNameTarget ? fileNameTarget.textContent : '';

        const updateFileName = () => {
            if (!fileNameTarget) {
                return;
            }
            fileNameTarget.textContent = input.files && input.files.length ? input.files[0].name : defaultText;
        };

        input.addEventListener('change', updateFileName);

        if (!zone) {
            return;
        }

        ['dragenter', 'dragover'].forEach((eventName) => {
            zone.addEventListener(eventName, (event) => {
                event.preventDefault();
                zone.classList.add('border-[#c4847a]', 'bg-[#fff8f6]');
            });
        });

        ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
            zone.addEventListener(eventName, (event) => {
                event.preventDefault();
                zone.classList.remove('border-[#c4847a]', 'bg-[#fff8f6]');
            });
        });

        zone.addEventListener('drop', (event) => {
            const droppedFile = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
            if (!droppedFile) {
                return;
            }
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(droppedFile);
            input.files = dataTransfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    document.querySelectorAll('form[data-confirm-message]').forEach((form) => {
        form.addEventListener('submit', (event) => {
            const message = form.dataset.confirmMessage;
            if (message && !window.confirm(message)) {
                event.preventDefault();
            }
        });
    });
});
