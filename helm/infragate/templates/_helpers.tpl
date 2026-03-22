{{- define "infragate.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "infragate.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "infragate.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "infragate.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "infragate.commonLabels" -}}
helm.sh/chart: {{ include "infragate.chart" . }}
app.kubernetes.io/name: {{ include "infragate.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- range $key, $value := .Values.commonLabels }}
{{ $key }}: {{ $value | quote }}
{{- end }}
{{- end -}}

{{- define "infragate.componentLabels" -}}
{{ include "infragate.commonLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "infragate.componentSelectorLabels" -}}
app.kubernetes.io/name: {{ include "infragate.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "infragate.backend.fullname" -}}
{{- printf "%s-backend" (include "infragate.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "infragate.frontend.fullname" -}}
{{- printf "%s-%s" (include "infragate.fullname" .root) .name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
