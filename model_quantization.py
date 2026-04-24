# from onnxruntime.quantization import quantize_dynamic, QuantType

# quantize_dynamic(
#     model_input="onnx_model_3/model.onnx",
#     model_output="onnx_model_3/model-int8.onnx",
#     weight_type=QuantType.QUInt8
# )

import os
from onnxruntime.quantization import quantize_dynamic, QuantType

onnx_dir = os.getenv("ONNX_MODEL_DIR", "onnx_model_3")

quantize_dynamic(
    model_input=f"{onnx_dir}/model.onnx",
    model_output=f"{onnx_dir}/model-int8.onnx",
    weight_type=QuantType.QUInt8,
)