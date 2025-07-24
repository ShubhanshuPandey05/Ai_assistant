from onnxruntime.quantization import quantize_dynamic, QuantType

quantize_dynamic(
    model_input="onnx_model_3/model.onnx",
    model_output="onnx_model_3/model-int8.onnx",
    weight_type=QuantType.QUInt8
)